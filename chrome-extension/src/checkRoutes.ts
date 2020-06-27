import routes from './routes.json';

const Marks = {
  Empty: 0,
  CN: 1,
  US: 2,
};

class IPNode {
  mark: number = Marks.Empty;
  children: IPNode[] = new Array<IPNode>(2)
  constructor() {}
}

function add(ip: number, depth: number, node: IPNode, range: number, mark: number) {
  if (depth === range) {
    node.mark = mark
    return
  }
  const next = (ip & (1 << (31 - depth))) ? 1 : 0;
  if (!node.children[next]) {
    node.children[next] = new IPNode()
  }
  add(ip, depth + 1, node.children[next], range, mark);
}

const root = new IPNode();

for (let i = 0; i < routes.length / 3; i++) {
  const [ip, range, mark] = [0, 1, 2].map(idx => routes[idx + i * 3]);
  add(ip, 0, root, range, mark);
}

function check(mark: number, ip: number, depth: number, node?: IPNode): number {
  if (!node) return mark;
  const next = (ip & (1 << (31 - depth))) ? 1 : 0;
  const nextMark = node.mark ? node.mark : mark;
  return check(nextMark, ip, depth + 1, node.children[next]);
}

export function ipv4ToInt(ip: string): number {
  return ip.split('.')
    .map(v => parseInt(v, 10))
    .reduce((acc, v) => (acc << 8) | v, 0)
}

export function isCN(ipV4: string): boolean {
  return check(root.mark, ipv4ToInt(ipV4), 0, root) === Marks.CN;
}
