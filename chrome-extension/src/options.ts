import * as ace from 'ace-builds';
import mode from 'ace-builds/src-noconflict/mode-yaml';
import * as yaml from 'js-yaml'; 
import {validateConfig, storageSet, storageGet} from './utils';

import {snakeCaseToCamelCase, $} from './utils';
import { MessageType } from './messages';


const configEditor = ace.edit("config", {
  mode,
  autoScrollEditorIntoView: true,
  maxLines: Infinity,
  fontSize: 12  ,
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

$("#save").addEventListener('click', async function() {
  const session = configEditor.getSession();
  session.clearAnnotations();
  try {
    const configYaml = configEditor.getValue();
    const config = validateConfig(snakeCaseToCamelCase(yaml.safeLoad(configYaml)));
    chrome.runtime.sendMessage({type: MessageType.CONFIG_UPDATED, data: config});
    await storageSet({configYaml});
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
    } else if (Array.isArray(err)){
      const [{dataPath, message, params}] = err;
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

const defaultConfigYaml = `
# you can find the following config in go-shp server page after login

username: YOUR_USERNAME
token: YOUR_TOKEN
auth_base_path: /some-url/
listen_port: 8080

proxies:
- name: PROXY_GROUP_NAME
  hosts:
  - YOUR_PROXY_HOST_A:443
  - YOUR_PROXY_HOST_B:443
  select_policy: LATENCY # LATENCY / RANDOM / RANDOM_ON_SIMILAR_LOWEST_LATENCY
- name: PROXY_INTERNAL
  hosts:
  - YOUR_PROXY_HOST_C:443
  - YOUR_PROXY_HOST_D:443
  select_policy: RANDOM

rules:
- proxy_name: DIRECT
  domains:
  - 163.com
  - qq.com
  - cn
- proxy_name: PROXY_GROUP_NAME
  domains:
  - google.com
  - twitter.com
- proxy_name: PROXY_INTERNAL
  domains:
  - YOUR_INTERNAL_WEB.com

unmatched_policy:
  proxy_name: DIRECT
  detect: false # if proxy_name is DIRECT, this is ignored
  detect_delay_ms: 100
  detect_expires_second: 1800
  # or
  # proxy_name: PROXY_GROUP_NAME
  # detect: true # this will try with DIRECT and PROXY_GROUP_NAME

`;

storageGet({configYaml: defaultConfigYaml})
  .then(({configYaml}) => {
    configEditor.setValue(configYaml);
  });

