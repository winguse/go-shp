const DETECTION_CONNECT_TIMEOUT = 5000;
const DETECTION_PROXY_SETTING_FREQUENCY_CAP = 1000;

const DOMAIN_DETECT = {
  requested: new Set(),
  connected: new Set(),
  error: new Set(),
  toBeAdded: [],
  added: new Set(),
  notHelp: new Set(),
  toBeRemoved: [],
};
