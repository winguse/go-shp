
export enum MessageType {
  CONFIG_UPDATED,
  ON_OFF_UPDATED
}

export interface Message {
  type: MessageType,
  data?: any
}
