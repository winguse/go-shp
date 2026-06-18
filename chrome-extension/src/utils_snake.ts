export function camelToSnake(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(camelToSnake);
  }
  const result: any = {};
  for (const key of Object.keys(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, (g) => `_${g[0].toLowerCase()}`);
    result[snakeKey] = camelToSnake(obj[key]);
  }
  return result;
}
