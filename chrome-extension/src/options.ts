import * as ace from 'ace-builds';
import mode from 'ace-builds/src-noconflict/mode-yaml';
import * as yaml from 'js-yaml'; 
import {validateConfig, storageSet, storageGet, getConfig} from './utils';

import {snakeCaseToCamelCase, defaultConfigYaml, $} from './utils';
import { MessageType } from './messages';
import { ShpConfig } from './config';

const TOKEN_MASK = 'TOKEN_IS_CREDENTIAL_AND_IS_NOT_SHOWN_HERE';

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
    const {config: {token: previousToken}} = await getConfig();
    const configYaml = configEditor.getValue().replace(TOKEN_MASK, previousToken);
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

storageGet({configYaml: defaultConfigYaml})
  .then(({configYaml}: {configYaml: string}) => {
    const config: ShpConfig = snakeCaseToCamelCase(yaml.safeLoad(configYaml));
    configEditor.setValue(configYaml.replace(config.token, TOKEN_MASK));
  });

