import * as ace from 'ace-builds';
import mode from 'ace-builds/src-noconflict/mode-yaml';
import * as yaml from 'js-yaml';
import * as Chart from 'chart.js';

import { validateConfig, storageSet, storageGet, getConfig } from './utils';
import { snakeCaseToCamelCase, defaultConfigYaml, $ } from './utils';
import { MessageType } from './messages';
import { ShpConfig } from './config';
import { LatencyTestResult } from './background';
import log from './log';

const TOKEN_MASK = 'TOKEN_IS_CREDENTIAL_AND_IS_NOT_SHOWN_HERE';

const configEditor = ace.edit("config", {
  mode,
  autoScrollEditorIntoView: true,
  maxLines: Infinity,
  fontSize: 12,
  showLineNumbers: true,
  tabSize: 2,
});

// not sure why we need to set this string again
configEditor.getSession().setMode('ace/mode/yaml');

enum messageType {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

function showMessage(message: string, type: messageType = messageType.INFO, timeout: number = 60000) {
  // @ts-ignore
  clearTimeout(showMessage.timeout);
  const messageDiv = $("#message");
  messageDiv.innerHTML = message;
  messageDiv.className = type;
  // @ts-ignore
  showMessage.timeout = setTimeout(() => { messageDiv.innerHTML = ''; }, timeout);
}

$("#save").addEventListener('click', async function () {
  const session = configEditor.getSession();
  session.clearAnnotations();
  try {
    const { config: { token: previousToken } } = await getConfig();
    const configYaml = configEditor.getValue().replace(TOKEN_MASK, previousToken);
    const config = validateConfig(snakeCaseToCamelCase(yaml.safeLoad(configYaml)));
    chrome.runtime.sendMessage({ type: MessageType.CONFIG_UPDATED, data: config });
    await storageSet({ configYaml });
    showMessage('Config saved')
  } catch (err) {
    let annotation: ace.Ace.Annotation = null;
    if (err.mark) {
      annotation = {
        row: err.mark.line - 1,
        column: err.mark.column,
        text: err.reason,
        type: 'error'
      };
    } else if (Array.isArray(err)) {
      const [{ dataPath, message, params }] = err;
      annotation = {
        row: 0,
        column: 0,
        text: `${dataPath} ${message} ${JSON.stringify(params)}`,
        type: 'error'
      };
    }
    if (annotation) {
      session.setAnnotations([annotation]);
      showMessage(annotation.text, messageType.ERROR);
    }
  }
});

storageGet({ configYaml: defaultConfigYaml })
  .then(({ configYaml }: { configYaml: string }) => {
    const config: ShpConfig = snakeCaseToCamelCase(yaml.safeLoad(configYaml));
    configEditor.setValue(configYaml.replace(config.token, TOKEN_MASK));
  });

const colorMap = {};
function randomColor(): string {
  return `rgb(${[128, 128, 128].map(v => 127 + Math.floor(Math.random() * v)).join(',')})`;
};
function getColor(label: string): string {
  return colorMap[label] || (colorMap[label] = randomColor());
}

let latencyChart: Chart = undefined;
function renderHistory(history: Array<LatencyTestResult>) {
  log.debug('[render]', history);
  const timeoutValue = '5000';
  // @ts-ignore
  const ctx = $("#latency-test-history").getContext('2d');
  const commonHost = history.map(({host}) => host).reduceRight((common, current) => {
    let i = 1;
    for (;i <= common.length && i <= current.length && common.substring(common.length - i) === current.substring(current.length - i); i++) {
      // nop
    }
    return current.substring(current.length - i + 1);
  });
  const datasets = history.reduce((acc, { host, latency, time }) => {
    host = host.replace(commonHost, '');
    let dataset = acc.find(d => d.label === host);
    if (!dataset) {
      dataset = {
        fill: false,
        label: host,
        data: [],
        backgroundColor: getColor(host),
        borderColor: getColor(host),
        borderWidth: 1,
      };
      acc.push(dataset);
    }
    const point: Chart.ChartPoint = {
      x: new Date(time),
      y: latency ? latency : timeoutValue,
    }
    // @ts-ignore
    const chartPoints: Chart.ChartPoint[] = dataset.data;
    chartPoints.push(point)
    return acc;
  }, new Array<Chart.ChartDataSets>());
  if (latencyChart) {
    latencyChart.data = {datasets};
    latencyChart.update();
    return;
  }
  latencyChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets,
    },
    options: {
      aspectRatio: 1,
      animation: { duration: 0 },
      tooltips: {
        callbacks: {
          label: function (tooltipItem, data) {
            const dataset = data.datasets[tooltipItem.datasetIndex];
            var label = dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (tooltipItem.value === timeoutValue) {
              label += 'timeout / error';
            } else {
              label += tooltipItem.yLabel + ' ms';
            }
            return label;
          }
        }
      },
      scales: {
        yAxes: [{
          type: 'logarithmic',
        }],
        xAxes: [{
          type: 'time',
          time: {
            unit: 'minute',
          }
        }]
      }
    }
  });
}

const latencyTestBtn = $('#latency-test');
latencyTestBtn.addEventListener('click', () => {
  // @ts-ignore
  latencyTestBtn.disabled = true;
  chrome.runtime.sendMessage({ type: MessageType.TRIGGER_LATENCY_TEST });
});

chrome.runtime.sendMessage({ type: MessageType.GET_LATENCY_HISTORY }, renderHistory);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MessageType.LATENCY_TEST_DONE) {
    // @ts-ignore
    latencyTestBtn.disabled = false;
    renderHistory(message.data);
  } else if (message.type === MessageType.ERROR) {
    showMessage(message.data, messageType.ERROR);
  }
});
