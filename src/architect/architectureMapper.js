// src/architect/architectureMapper.js
// ─────────────────────────────────────────────────────────────
// Day 4 core logic.
//
// Takes the scan result from Day 3 and converts it into a graph
// with 'nodes' and 'edges' — ready for React Flow (Person B).
//
// How it works:
//   1. Each detected service (Express, PostgreSQL, Redis...) becomes a NODE
//   2. SERVICE_DEFINITIONS tells us what category each service belongs to
//      and what other categories it connects to
//   3. We use those connections to draw EDGES between nodes
//   4. We assign x/y positions by category so the layout flows left→right:
//      Internet → Proxy → Frontend → Backend → Database / Cache / Queue
//
// This is fully deterministic — no AI guessing. The rules come from
// real-world knowledge of how these technologies interact.
// ─────────────────────────────────────────────────────────────

// ── Service definitions ───────────────────────────────────────
// Maps every technology we might detect to a node definition.
// 'connectsTo' lists the CATEGORIES this service sends data to.
// 'gcpMapping' is picked up by Day 5's GCP planner.
const SERVICE_DEFINITIONS = {
  // Backend
  'Express.js':  { category: 'backend',        label: 'Express.js Server',   icon: 'server',    gcpMapping: 'Cloud Run',                connectsTo: ['database','cache','queue','frontend','api'], port: 3000 },
  'Fastify':     { category: 'backend',        label: 'Fastify Server',      icon: 'server',    gcpMapping: 'Cloud Run',                connectsTo: ['database','cache','queue'],                  port: 3000 },
  'NestJS':      { category: 'backend',        label: 'NestJS Server',       icon: 'server',    gcpMapping: 'Cloud Run',                connectsTo: ['database','cache','queue'],                  port: 3000 },
  'Django':      { category: 'backend',        label: 'Django App',          icon: 'server',    gcpMapping: 'Cloud Run',                connectsTo: ['database','cache','queue'],                  port: 8000 },
  'Flask':       { category: 'backend',        label: 'Flask App',           icon: 'server',    gcpMapping: 'Cloud Run',                connectsTo: ['database','cache'],                          port: 5000 },
  'FastAPI':     { category: 'backend',        label: 'FastAPI App',         icon: 'server',    gcpMapping: 'Cloud Run',                connectsTo: ['database','cache','queue'],                  port: 8000 },
  // Full-stack
  'Next.js':     { category: 'fullstack',      label: 'Next.js App',         icon: 'browser',   gcpMapping: 'Cloud Run',                connectsTo: ['database','cache','api'],                    port: 3000 },
  // Frontend
  'React':       { category: 'frontend',       label: 'React Frontend',      icon: 'browser',   gcpMapping: 'Cloud Storage + CDN',      connectsTo: ['backend','api'],                             port: null },
  'Vue.js':      { category: 'frontend',       label: 'Vue.js Frontend',     icon: 'browser',   gcpMapping: 'Cloud Storage + CDN',      connectsTo: ['backend','api'],                             port: null },
  'Angular':     { category: 'frontend',       label: 'Angular Frontend',    icon: 'browser',   gcpMapping: 'Cloud Storage + CDN',      connectsTo: ['backend','api'],                             port: null },
  // Databases
  'PostgreSQL':  { category: 'database',       label: 'PostgreSQL',          icon: 'database',  gcpMapping: 'Cloud SQL (PostgreSQL)',    connectsTo: [],                                            port: 5432 },
  'MySQL':       { category: 'database',       label: 'MySQL',               icon: 'database',  gcpMapping: 'Cloud SQL (MySQL)',         connectsTo: [],                                            port: 3306 },
  'MongoDB':     { category: 'database',       label: 'MongoDB',             icon: 'database',  gcpMapping: 'MongoDB Atlas on GCP',     connectsTo: [],                                            port: 27017 },
  // Cache
  'Redis':       { category: 'cache',          label: 'Redis Cache',         icon: 'cache',     gcpMapping: 'Memorystore (Redis)',       connectsTo: [],                                            port: 6379 },
  // Queue
  'Celery':      { category: 'queue',          label: 'Celery Worker',       icon: 'worker',    gcpMapping: 'Cloud Tasks',              connectsTo: ['database','cache'],                          port: null },
  'RabbitMQ':    { category: 'queue',          label: 'RabbitMQ',            icon: 'queue',     gcpMapping: 'Pub/Sub',                  connectsTo: [],                                            port: 5672 },
  // Proxy / infrastructure
  'Nginx':       { category: 'proxy',          label: 'Nginx Proxy',         icon: 'proxy',     gcpMapping: 'Cloud Load Balancing',     connectsTo: ['backend','frontend'],                        port: 80   },
  'GraphQL':     { category: 'api',            label: 'GraphQL API',         icon: 'api',       gcpMapping: 'Cloud Endpoints',          connectsTo: ['database'],                                  port: null },
  'Docker':      { category: 'infrastructure', label: 'Docker',              icon: 'container', gcpMapping: 'Artifact Registry',        connectsTo: [],                                            port: null },
  'Docker Compose': { category: 'infrastructure', label: 'Docker Compose',   icon: 'container', gcpMapping: 'Cloud Run (multi-service)', connectsTo: [],                                           port: null },
};

// ── Layout positions ──────────────────────────────────────────
// React Flow needs explicit x/y for every node.
// We group by category and stack vertically within each group.
const CATEGORY_X = {
  internet:       0,
  proxy:          220,
  frontend:       440,
  fullstack:      440,
  backend:        660,
  api:            660,
  database:       900,
  cache:          900,
  queue:          900,
  infrastructure: 1120,
};

const Y_BASE    = 100;   // First node in any column starts here
const Y_SPACING = 160;   // Vertical gap between nodes in the same column

// ── Edge labels ───────────────────────────────────────────────
const EDGE_LABELS = {
  'internet→proxy':    'HTTPS',
  'internet→frontend': 'HTTPS',
  'internet→backend':  'HTTPS',
  'proxy→backend':     'HTTP',
  'proxy→frontend':    'HTTP',
  'frontend→backend':  'REST / GraphQL',
  'fullstack→database':'SQL / ORM',
  'backend→database':  'SQL / ORM',
  'backend→cache':     'Redis protocol',
  'backend→queue':     'AMQP',
  'backend→api':       'HTTP',
  'queue→database':    'SQL / ORM',
};

/**
 * generateArchitectureGraph
 *
 * @param {Object} scanResult - Output from repoScanner.scanRepository()
 * @returns {{ nodes, edges, metadata }}
 *   nodes and edges are ready to pass directly to React Flow.
 */
function generateArchitectureGraph(scanResult) {
  const { frameworks, infrastructure, languages } = scanResult;

  // ── 1. Collect all detected technology names ───────────────
  const allNames = [
    ...frameworks.map(f => f.name),
    ...infrastructure.map(i => i.name),
  ];

  // ── 2. Match to SERVICE_DEFINITIONS ───────────────────────
  // Deduplicate via Map so the same technology doesn't appear twice
  // (e.g. PostgreSQL detected from both package.json and docker-compose.yml).
  const serviceMap = new Map();
  allNames
    .filter(name => SERVICE_DEFINITIONS[name])
    .forEach(name => serviceMap.set(name, { name, ...SERVICE_DEFINITIONS[name] }));

  const services = Array.from(serviceMap.values());

  // ── 3. Add the "Internet" entry node ──────────────────────
  // Every architecture has users arriving from the internet.
  // This gives the graph a clear left-hand starting point.
  const entryService = {
    name: 'Internet',
    category: 'internet',
    label: 'Users / Internet',
    icon: 'globe',
    gcpMapping: 'Cloud Armor',
    connectsTo: ['proxy', 'frontend', 'fullstack', 'backend'],
    port: null,
  };

  const allServices = [entryService, ...services];

  // ── 4. Build NODES ─────────────────────────────────────────
  // Count how many nodes we've placed in each category column
  // so we can stack them vertically.
  const columnCounters = {};

  const nodes = allServices.map(service => {
    const col  = service.category;
    const xPos = CATEGORY_X[col] ?? 1300;

    if (!columnCounters[col]) columnCounters[col] = 0;
    const yPos = Y_BASE + columnCounters[col] * Y_SPACING;
    columnCounters[col]++;

    // Node IDs must be stable strings — we derive them from the service name.
    const id = `node-${service.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;

    return {
      id,
      position: { x: xPos, y: yPos },
      // 'data' is everything Person B's custom node component needs to render.
      data: {
        label:      service.label,
        category:   service.category,
        icon:       service.icon,
        description: service.description || '',
        gcpMapping: service.gcpMapping,
        port:       service.port,
        name:       service.name,
      },
      // Person B will create a React Flow node type called 'serviceNode'.
      type: 'serviceNode',
    };
  });

  // ── 5. Build EDGES ─────────────────────────────────────────
  // Index nodes by category so we can look up targets quickly.
  const categoryIndex = {};
  nodes.forEach(node => {
    const cat = node.data.category;
    if (!categoryIndex[cat]) categoryIndex[cat] = [];
    categoryIndex[cat].push(node.id);
  });

  const edges = [];
  let edgeId  = 0;

  allServices.forEach(service => {
    const sourceId = `node-${service.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;

    service.connectsTo.forEach(targetCategory => {
      (categoryIndex[targetCategory] || []).forEach(targetId => {
        if (sourceId === targetId) return;   // No self-loops

        edges.push({
          id:       `edge-${edgeId++}`,
          source:   sourceId,
          target:   targetId,
          type:     'smoothstep',
          animated: false,
          style:    { stroke: '#6B7280', strokeWidth: 2 },
          label:    EDGE_LABELS[`${service.category}→${targetCategory}`] || '',
        });
      });
    });
  });

  // ── 6. Build metadata ──────────────────────────────────────
  const metadata = {
    totalServices:      services.length,
    hasDatabase:        services.some(s => s.category === 'database'),
    hasCache:           services.some(s => s.category === 'cache'),
    hasQueue:           services.some(s => s.category === 'queue'),
    hasProxy:           services.some(s => s.category === 'proxy'),
    isContainerised:    allNames.includes('Docker') || allNames.includes('Docker Compose'),
    languages:          languages.map(l => l.name),
    // List of GCP products needed — handed to Day 5's GCP planner.
    requiredGcpProducts: [...new Set(services.map(s => s.gcpMapping).filter(Boolean))],
  };

  return { nodes, edges, metadata };
}

module.exports = { generateArchitectureGraph, SERVICE_DEFINITIONS };
