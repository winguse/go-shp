
export enum MessageType {
  CONFIG_UPDATED,
  ON_OFF_UPDATED,
  GET_LATENCY_HISTORY,
  TRIGGER_LATENCY_TEST,
  LATENCY_TEST_DONE,
  ERROR,
}

export interface Message {
  type: MessageType,
  data?: any
}
