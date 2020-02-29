import * as ace from 'ace-builds';
import mode from 'ace-builds/src-noconflict/mode-yaml';
import * as yaml from 'js-yaml'; 
import {validateConfig} from './utils';

import {snakeCaseToCamelCase} from './utils';


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

document.querySelector("#save").addEventListener('click', function() {
  const session = configEditor.getSession();
  session.clearAnnotations();
  try {
    const config = validateConfig(snakeCaseToCamelCase(yaml.safeLoad(configEditor.getValue())));
    console.log(config);
  } catch (err) {
    if (err.mark) {
      session.setAnnotations([{
        row: err.mark.line - 1,
        column: err.mark.column,
        text: err.reason,
        type: 'error'
      }]);
    } else if (Array.isArray(err)){
      const [{dataPath, message, params}] = err;
      session.setAnnotations([{
        row: 0,
        column: 0,
        text: `${dataPath} ${message} ${JSON.stringify(params)}`,
        type: 'error'
      }]);
    }
  }
});
