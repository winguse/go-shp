
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
  config.login.serverList
    .forEach(host => {
      const latency = config.latencyTestResult[host] || '-'
      $("#globalProxySelection").appendChild(createOption(host, latency));
      $("#ruleProxySelection").appendChild(createOption(host, latency));
    });
  Object.keys(config.userInput)
    .forEach(key => {
      if (key.indexOf('domains') >= 0 || key === 'servers') {
        proxyForm[key].value = config.userInput[key].join('\n');
      } else {
        proxyForm[key].value = config.userInput[key];
      }
    });
  changeUIStateByAuthType();
}

proxyForm.onsubmit = async e => {
  e.preventDefault();
  e.stopPropagation();
  show('Saving config, please wait...');
  updateConfig(config => {
    Object.keys(config.userInput)
      .forEach(key => {
        if (key.indexOf('domains') >= 0 || key === 'servers') {
          config.userInput[key] = [...new Set(proxyForm[key].value.split('\n').filter(l => l))].sort();
        } else {
          config.userInput[key] = proxyForm[key].value;
        }
      });
    if (config.userInput.authType === 'password') {
      config.login.email = config.userInput.username;
      config.login.token = config.userInput.password;
      config.login.serverList = config.userInput.servers;
      config.login.triggerToken = config.userInput.triggerToken;
      config.login.expireTime = Number.MAX_SAFE_INTEGER;
    }
  });
  await applyProxySetting();
  window.close();
};

$("#loginButton").onclick = (e) => {
  e.preventDefault();
  e.stopPropagation();
  const authUrl = new URL(proxyForm.authUrl.value);
  updateConfig(config => {
    config.userInput.authType = 'api';
    config.userInput.authUrl = authUrl.toString();
  });
  authUrl.searchParams.set("html", "1");
  chrome.tabs.create({ url: authUrl.toString() });
  window.close();
};

$("#copyCLIExports").onclick = async e => {
  e.preventDefault();
  e.stopPropagation();
  const { config: { login: { email, token } } } = SHP;
  await navigator.clipboard.writeText(`export SHP_USERNAME=${email}&&export SHP_PASSWORD=${token}`);
  show('Copied!')
};

function changeUIStateByAuthType() {
  const config = SHP.config;
  const isApi = proxyForm.authType.value === 'api';
  let detailConfigDisabled = true;
  if (isApi) {
    if (!config.userInput.authUrl) {
      show('Please setup Auth URL and click login button.');
    } else if (!config.login.email) {
      show('It seems you have not login, please click login button try again.');
    } else {
      detailConfigDisabled = false;
    }
  } else {
    detailConfigDisabled = false;
  }
  $('label[for="authUrl"]').style.display = isApi ? '' : 'none';
  ['username', 'password', 'servers', 'triggerToken'].forEach(k => {
    $(`label[for="${k}"]`).style.display = isApi ? 'none' : '';
  });
  $("#ruleBased").disabled = detailConfigDisabled;
  $("#global").disabled = detailConfigDisabled;
  $("#submit").disabled = detailConfigDisabled;
  $("#copyCLIExports").disabled = detailConfigDisabled;
}

$("#authType").onchange = changeUIStateByAuthType;

let showHandle = 0;
function show(msg) {
  const errMsg = $("#error-message")
  errMsg.innerText = msg;
  clearTimeout(showHandle);
  showHandle = this.setTimeout(() => { errMsg.innerText = ''; }, 5000);
};

window.onerror = show;
window.addEventListener('unhandledrejection', ({ reason }) => show(reason));

initPage();

