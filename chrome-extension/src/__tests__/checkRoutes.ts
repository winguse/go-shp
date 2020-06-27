
import { isCN } from '../checkRoutes';


test('check CN ranges', () => {
  expect(isCN('127.0.0.1')).toBe(true)
  expect(isCN('203.208.43.97')).toBe(true)
  expect(isCN('114.114.114.114')).toBe(true)
  expect(isCN('172.217.5.110')).toBe(false)
  expect(isCN('8.8.8.8')).toBe(false)
})
