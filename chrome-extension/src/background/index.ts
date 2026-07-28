import { setProxy } from "./pac";
import { registerAuthListener } from "./auth";
import { registerHealthCheckAlarm, checkHealth, setupHealthCheckAlarm } from "./health";
import { getSettings } from "../storage";

registerAuthListener();
registerHealthCheckAlarm();

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SETTINGS_UPDATED") {
    setProxy(message.settings);
    setupHealthCheckAlarm();
    checkHealth();
  } else if (message.type === "TRIGGER_HEALTH_CHECK") {
    checkHealth();
  }
});

// Initialize on startup
getSettings().then((settings) => {
  setProxy(settings);
  checkHealth();
});
