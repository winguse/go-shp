
const $ = (s) => document.querySelector(s);

const proxyForm = document.forms.proxyForm;

function createOption(value, latency) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.innerText = `${value} (${latency} ms)`;
  return opt;
}

function initPage() {
  const { config } = SHP;

  if (!config.userInput.authUrl) {
    show('Please setup Auth URL and click login button.');
    return;
  }

  if (!config.login.email) {
    show('It seems you have not login, please click login button try again.');
    return;
  }

  $("#ruleBased").disabled = false;
  $("#global").disabled = false;
  $("#submit").disabled = false;

  config.login.serverList
    .forEach(host => {
      const latency = config.latencyTestResult[host] || '-'
      $("#globalProxySelection").appendChild(createOption(host, latency));
      $("#ruleProxySelection").appendChild(createOption(host, latency));
    });
  Object.keys(config.userInput)
    .forEach(key => {
      if (key.indexOf('domains') >= 0) {
        proxyForm[key].value = config.userInput[key].join('\n');
      } else {
        proxyForm[key].value = config.userInput[key];
      }
    });
}

proxyForm.onsubmit = async e => {
  e.preventDefault();
  e.stopPropagation();
  show('Saving config, please wait...');
  updateConfig(config =>
    Object.keys(config.userInput)
      .forEach(key => {
        if (key.indexOf('domains') >= 0) {
          config.userInput[key] = [...new Set(proxyForm[key].value.split('\n').filter(l => l))].sort();
        } else {
          config.userInput[key] = proxyForm[key].value;
        }
      })
  );
  await applyProxySetting();
  window.close();
};

$("#loginButton").onclick = (e) => {
  e.preventDefault();
  e.stopPropagation();
  const authUrl = new URL(proxyForm.authUrl.value);
  updateConfig(config => config.userInput.authUrl = authUrl.toString());
  authUrl.searchParams.set("html", "1");
  chrome.tabs.create({ url: authUrl.toString() });
  window.close();
};

let showHandle = 0;
function show(msg) {
  const errMsg = $("#error-message")
  errMsg.innerText = msg;
  clearTimeout(showHandle);
  showHandle = this.setTimeout(() => { errMsg.innerText = ''; }, 5000);
};

window.onerror = show;
window.addEventListener('unhandledrejection', ({reason}) => show(reason));

initPage();

