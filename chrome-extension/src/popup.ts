import { getConfig, storageSet, $ } from "./utils";
import { MessageType } from "./messages";

function updateUI(enabled: boolean) {
  $('#on').className = enabled ? 'active' : '';
  $('#off').className = !enabled ? 'active' : '';
}

function onOff(isOn: boolean) {
  const dom = $(isOn ? '#on' : '#off');
  dom.addEventListener('click', async () => {
    await storageSet({enabled: isOn});
    chrome.runtime.sendMessage({type: MessageType.ON_OFF_UPDATED});
    updateUI(isOn);
    window.close();
  });
}


async function main() {
  [true, false].forEach(onOff);
  const {enabled} = await getConfig();
  updateUI(enabled);
}

main();
