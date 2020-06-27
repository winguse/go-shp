// usage: deno run  --unstable --allow-write --allow-net gen-ip-ranges.ts

import { writeJson } from "https://deno.land/std@0.51.0/fs/mod.ts";

// the following ips, we can allow them to access direct via CN network
// to avoid proxy in vpn
// using /24 is to avoid too many fragments
const ALWAYS_CN_RANGES = [
  // well known private ips:
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

/**
 * get content from URL
 */
async function get(url: string): Promise<string> {
  const res = await fetch(url);
  return await res.text();
}

/**
 * The marks for {IPNode}s
 */
const Marks = {
  Empty: 0,
  CN: 1,
  US: 2,
};

class Route {
  ip = 0
  range = 0
  mark = Marks.CN

  constructor(ip = 0, range = 0, mark = Marks.CN) {
    this.ip = ip
    this.range = range
    this.mark = mark
  }
}

class Solution {
  count = 0x7fff
  childrenMarks = [0, 0]
}


/**
 * The IP Node
 */
class IPNode {

  /**
   * route mark
   * @type {Number}
   */
  mark = Marks.Empty;

  /**
   * the route mark set of the subtree, including the current one
   */
  markSet: {[key in number]: boolean} = {};

  /**
   * two children of the current node
   * @type {IPNode[]}
   */
  children: IPNode[] = new Array<IPNode>(2)

  /**
   * the dp solutions
   * @type {Solution[]}
   */
  solutions = [new Solution(), new Solution(), new Solution()]

  constructor() {}
}

/**
 * add IP to the tree
 */
function add(ip: number, depth: number, node: IPNode, range: number, mark: number) {
  if (depth === range) {
    if (node.mark) {
      console.error('[warn] marking to existing mark', intToIPv4(ip), depth, range, mark, node.mark)
      return
    }
    const validChildren = node.children.filter(c => c);
    if (validChildren.length > 0) {
      console.error('[warn] marking bigger range to existing ranges', intToIPv4(ip), depth, range, mark, node.mark)
      for (let next = 0; next < 2; next++) {
          if (!node.children[next]) {
            node.children[next] = new IPNode()
          }
          add(ip | (next << (31 - depth)), depth + 1, node.children[next], range + 1, mark);
      }
      return
    }
    node.mark = mark
    return
  }
  if (node.mark) {
    console.error('[warn] marking smaller range to existing a bigger range', intToIPv4(ip), depth, range, mark, node.mark)
    return
  }
  const next = (ip & (1 << (31 - depth))) ? 1 : 0;
  if (!node.children[next]) {
    node.children[next] = new IPNode()
  }
  add(ip, depth + 1, node.children[next], range, mark);
}

/**
 * IP addr to ip integer
 */
function ipv4ToInt(ip: string): number {
  return ip.split('.')
    .map(v => parseInt(v, 10))
    .reduce((acc, v) => (acc << 8) | v, 0)
}

/**
 * 
 */
function intToIPv4(ip: number): string {
  const items = []
  for (let i = 0; i < 4; i++) {
    items.push(ip & 0xff)
    ip >>>= 8
  }
  return items.reverse().map(v => v.toString(10)).join('.')
}

/**
 * mark the tree by file content
 */
async function markByUrl(url: string, mark: number, countryCode: string, root: IPNode, added: string[]) {
  const content = await get(url)
  content.split('\n')
    .map(l => l.trim())
    .filter(l => !l.startsWith('#'))
    .map(l => l.split('|'))
    .map(([, country, type, addr, count]) => ({
      country, type, addr, count: +count,
    }))
    .filter(({country, type}) => country === countryCode && type === 'ipv4')
    .forEach(({addr, count}) => {
      const range = Math.floor(32 - Math.log2(count))
      const ip = ipv4ToInt(addr)
      // console.log(countryCode, addr, ip, range)
      add(ip, 0, root, range, mark)
      added.push(`${addr}/${range}`)
    })
}

/**
 * merge the country IPs ranges so that it do not contains other country IPs, but can contains undefined IPs
 */
function merge(node: IPNode): {[key in number]: boolean} {
  if (!node) return {};
  const [left, right] = node.children.map(merge);
  node.markSet = {[node.mark]: true, ...left, ...right};
  return node.markSet;
}

/**
 * Print ranges
 */
function mergeResult(node: IPNode, ip: number, depth: number, result: Route[]) {
  if (!node) return;
  const marks = Object.keys(node.markSet).map(m => +m).filter(m => m !== Marks.Empty);
  if (marks.length === 1) {
    result.push(new Route(ip, depth, marks[0]))
    return;
  }

  mergeResult(node.children[0], ip,                       depth + 1, result)
  mergeResult(node.children[1], ip | (1 << (31 - depth)), depth + 1, result)
}

/**
 * dynamic programming to the the most optimized tree
 */
function dp(node: IPNode) {
  if (!node) {
    const emptyMarkSolution = [new Solution(), new Solution(), new Solution()]
    emptyMarkSolution[0].count = 0
    return emptyMarkSolution
  }

  if (node.mark) {
    node.solutions[node.mark].count = 1
    return node.solutions
  }

  const leftChildSolutions = dp(node.children[0])
  const rightChildSolutions = dp(node.children[1])

  for (let currentMark = 1; currentMark < 3; currentMark++) {
    for (let leftChildMark = 0; leftChildMark < 3; leftChildMark++) {
      for (let rightChildMark = 0; rightChildMark < 3; rightChildMark++) {
        let count = leftChildSolutions[leftChildMark].count + rightChildSolutions[rightChildMark].count;
        if (leftChildMark === rightChildMark && currentMark === leftChildMark) {
          count --
        } else if (currentMark !== leftChildMark && currentMark !== rightChildMark) {
          count ++
        }
        if (count < node.solutions[currentMark].count) {
          node.solutions[currentMark].count = count
          node.solutions[currentMark].childrenMarks = [leftChildMark, rightChildMark]
        }
      }
    }
  }
  return node.solutions;
}

/**
 * get the final result form IP tree
 */
function getResult(node: IPNode, ip: number, depth: number, mark: number, parentMark: number, result: Route[]) {
  if (!node) {
    return
  }

  if (mark !== parentMark) {
    result.push(new Route(ip, depth, mark))
  }

  const {childrenMarks: [leftMark, rightMark], count} = node.solutions[mark]

  getResult(node.children[0], ip,                       depth + 1, leftMark,  mark, result)
  getResult(node.children[1], ip | (1 << (31 - depth)), depth + 1, rightMark, mark, result)
}

const OPTIMIZE_ROUTE_COUNT = 0;
const MERGE_IP_RANGES = 1;

async function main(mode = OPTIMIZE_ROUTE_COUNT) {
  const root = new IPNode()
  const cnRawRanges = new Array<string>()
  // we are putting CN always ranges ahead, so that those range contains them will be always route to CN network
  ALWAYS_CN_RANGES.forEach(cidr => {
    const [ipStr, rangeStr] = cidr.split('/');
    const ip = ipv4ToInt(ipStr)
    add(ip, 0, root, +rangeStr, Marks.CN);
  });
  await markByUrl('https://ftp.apnic.net/stats/apnic/delegated-apnic-latest', Marks.CN, 'CN', root, cnRawRanges)
  await markByUrl('https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest', Marks.US, 'US', root, [])

  // cnRawRanges.forEach(range => console.log(`CN_RAW: ${range}`))

  const result = new Array<Route>();

  if (mode === OPTIMIZE_ROUTE_COUNT) {
    dp(root)
    const mark = root.solutions[Marks.CN].count < root.solutions[Marks.US].count ? Marks.CN : Marks.US
    const solution = root.solutions[mark];
    result.push(new Route(0, 0, mark))
    getResult(root.children[0], 0 << 31, 1, solution.childrenMarks[0], mark, result)
    getResult(root.children[1], 1 << 31, 1, solution.childrenMarks[1], mark, result)

    // result.sort(({range: a}, {range: b}) => b - a).forEach(({ip, mark, range}) => {
    //   console.log(`${mark === Marks.CN ? 'CN' : 'US'}: ${intToIPv4(ip)}/${range}`)
    // });

    // console.log(root.solutions)
    // console.log(result.length)
  } else if (mode === MERGE_IP_RANGES) {
    merge(root);
    mergeResult(root, 0, 0, result);
    // result.forEach(({ip, mark, range}) => {
    //   console.log(`${mark === Marks.CN ? 'CN' : 'US'}: ${intToIPv4(ip)}/${range}`)
    // });
  }

  await writeJson("./chrome-extension/src/routes.json", result.flatMap(({ip, range, mark}) => ([ip, range, mark])));
}

await main();