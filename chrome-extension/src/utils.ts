import { ShpConfig } from './config';
import * as configValidator from './config.validator.js';



function iterateObject(input: any, changeCase: (key: string) => string): any {
  if (Array.isArray(input)) {
    return input.map(item => iterateObject(item, changeCase));
  }
  if (input && typeof input === 'object') {
    return Object.keys(input).reduce((result, key) => {
      result[changeCase(key)] = iterateObject(input[key], changeCase);
      return result;
    }, {});
  }
  return input;
}

export function snakeCaseToCamelCase(input: any): any {
  return iterateObject(input, (key: string) => {
    return key.split('_').map((part, index) => {
      if (index === 0) return part;
      return part[0].toUpperCase() + part.slice(1);
    }).join('');
  });
}

export function camelCaseToSnakeCase(input: any): any {
  return iterateObject(input, (key: string) => {
    return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  });
}

export function validateConfig(input: any): ShpConfig {
  if (configValidator(input)) {
    return input;
  }
  throw configValidator.errors;
}
