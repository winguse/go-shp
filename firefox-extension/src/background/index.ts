import { setProxy } from "./pac";
import { registerAuthListener } from "./auth";
import { registerHealthCheckAlarm, checkHealth, setupHealthCheckAlarm } from "./health";
import { getSettings } from "../storage";

const extApi = typeof browser !== 'undefined' ? browser : chrome;

registerAuthListener();
registerHealthCheckAlarm();

extApi.runtime.onMessage.addListener((message: any) => {
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
