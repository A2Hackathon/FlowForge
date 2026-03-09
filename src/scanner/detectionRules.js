// src/scanner/detectionRules.js
// ─────────────────────────────────────────────────────────────
// All detection rules defined as pure data.
// The scanner (repoScanner.js) contains the logic that applies
// these rules — keeping data and logic separate makes it easy to
// add new frameworks without touching any scanner code.
//
// Three rule types:
//   LANGUAGE_RULES     → which files indicate which language
//   CONTENT_RULES      → which strings inside files indicate a framework
//   COMPLIANCE_RULES   → security/ops files we look for
// ─────────────────────────────────────────────────────────────

// ── LANGUAGE RULES ────────────────────────────────────────────
// If ANY of the indicatorFiles exist in the repo, the language is detected.
// contentFile is the one we'll read for further framework detection.
const LANGUAGE_RULES = [
  { name: 'JavaScript / Node.js', indicatorFiles: ['package.json'],                               contentFile: 'package.json'       },
  { name: 'TypeScript',           indicatorFiles: ['tsconfig.json'],                              contentFile: 'package.json'       },
  { name: 'Python',               indicatorFiles: ['requirements.txt','setup.py','pyproject.toml'], contentFile: 'requirements.txt'   },
  { name: 'Ruby',                 indicatorFiles: ['Gemfile'],                                     contentFile: 'Gemfile'            },
  { name: 'Go',                   indicatorFiles: ['go.mod'],                                      contentFile: 'go.mod'             },
  { name: 'Java',                 indicatorFiles: ['pom.xml', 'build.gradle'],                     contentFile: null                 },
  { name: 'PHP',                  indicatorFiles: ['composer.json'],                               contentFile: 'composer.json'      },
  { name: 'Rust',                 indicatorFiles: ['Cargo.toml'],                                  contentFile: 'Cargo.toml'         },
];

// ── CONTENT RULES ─────────────────────────────────────────────
// If a specific string is found inside a specific file, that tech is detected.
// 'type' is used by the architecture mapper (Day 4) to categorise services.
const CONTENT_RULES = [
  // Node.js — backend frameworks
  { file: 'package.json', contains: '"express"',       name: 'Express.js',  type: 'backend',        description: 'Node.js web framework'               },
  { file: 'package.json', contains: '"fastify"',       name: 'Fastify',     type: 'backend',        description: 'Fast Node.js web framework'           },
  { file: 'package.json', contains: '"@nestjs/core"',  name: 'NestJS',      type: 'backend',        description: 'Structured Node.js framework'         },
  { file: 'package.json', contains: '"next"',          name: 'Next.js',     type: 'fullstack',      description: 'React full-stack framework'           },
  // Node.js — frontend frameworks
  { file: 'package.json', contains: '"react"',         name: 'React',       type: 'frontend',       description: 'UI component library'                },
  { file: 'package.json', contains: '"vue"',           name: 'Vue.js',      type: 'frontend',       description: 'Progressive UI framework'            },
  { file: 'package.json', contains: '"@angular/core"', name: 'Angular',     type: 'frontend',       description: 'TypeScript-first frontend framework'  },
  // Node.js — databases & caches
  { file: 'package.json', contains: '"pg"',            name: 'PostgreSQL',  type: 'database',       description: 'Relational database'                 },
  { file: 'package.json', contains: '"mysql2"',        name: 'MySQL',       type: 'database',       description: 'Relational database'                 },
  { file: 'package.json', contains: '"mongoose"',      name: 'MongoDB',     type: 'database',       description: 'NoSQL document database'             },
  { file: 'package.json', contains: '"redis"',         name: 'Redis',       type: 'cache',          description: 'In-memory cache'                     },
  { file: 'package.json', contains: '"prisma"',        name: 'Prisma',      type: 'tooling',        description: 'Type-safe ORM'                       },
  { file: 'package.json', contains: '"graphql"',       name: 'GraphQL',     type: 'api',            description: 'Flexible query API layer'            },
  { file: 'package.json', contains: '"electron"',      name: 'Electron',    type: 'desktop',        description: 'Desktop app framework'               },
  // Python frameworks
  { file: 'requirements.txt', contains: 'django',      name: 'Django',      type: 'backend',        description: 'Python web framework'                },
  { file: 'requirements.txt', contains: 'flask',       name: 'Flask',       type: 'backend',        description: 'Lightweight Python framework'        },
  { file: 'requirements.txt', contains: 'fastapi',     name: 'FastAPI',     type: 'backend',        description: 'Modern async Python API framework'   },
  { file: 'requirements.txt', contains: 'sqlalchemy',  name: 'SQLAlchemy',  type: 'tooling',        description: 'Python SQL ORM'                      },
  { file: 'requirements.txt', contains: 'celery',      name: 'Celery',      type: 'queue',          description: 'Distributed task queue'              },
  { file: 'requirements.txt', contains: 'redis',       name: 'Redis',       type: 'cache',          description: 'In-memory cache'                     },
  // Docker
  { file: 'Dockerfile',        contains: 'EXPOSE 80',   name: 'Port 80',    type: 'network',        description: 'App listens on HTTP port 80'         },
  { file: 'Dockerfile',        contains: 'EXPOSE 443',  name: 'Port 443',   type: 'network',        description: 'App listens on HTTPS port 443'       },
  { file: 'Dockerfile',        contains: 'EXPOSE 3000', name: 'Port 3000',  type: 'network',        description: 'App listens on port 3000'            },
  { file: 'Dockerfile',        contains: 'EXPOSE 8080', name: 'Port 8080',  type: 'network',        description: 'App listens on port 8080'            },
  // Docker Compose services
  { file: 'docker-compose.yml', contains: 'postgres',  name: 'PostgreSQL',  type: 'database',       description: 'Relational database via Compose'     },
  { file: 'docker-compose.yml', contains: 'redis',     name: 'Redis',       type: 'cache',          description: 'Cache via Compose'                   },
  { file: 'docker-compose.yml', contains: 'nginx',     name: 'Nginx',       type: 'proxy',          description: 'Reverse proxy via Compose'           },
  { file: 'docker-compose.yml', contains: 'rabbitmq',  name: 'RabbitMQ',    type: 'queue',          description: 'Message broker via Compose'          },
  { file: 'docker-compose.yml', contains: 'mongo',     name: 'MongoDB',     type: 'database',       description: 'NoSQL database via Compose'          },
];

// ── INFRASTRUCTURE PRESENCE RULES ─────────────────────────────
// The mere presence of these files tells us something important,
// even before we read their contents.
const FILE_PRESENCE_RULES = {
  'Dockerfile':           { type: 'infrastructure', name: 'Docker'           },
  'docker-compose.yml':   { type: 'infrastructure', name: 'Docker Compose'   },
  'docker-compose.yaml':  { type: 'infrastructure', name: 'Docker Compose'   },
  '.gitlab-ci.yml':       { type: 'cicd',           name: 'GitLab CI/CD'     },
  'Jenkinsfile':          { type: 'cicd',           name: 'Jenkins'          },
  'terraform.tf':         { type: 'infrastructure', name: 'Terraform'        },
  'nginx.conf':           { type: 'infrastructure', name: 'Nginx'            },
};

// ── COMPLIANCE RULES ──────────────────────────────────────────
// Files that indicate good security/operational hygiene.
// We report both what's present (good) and what's missing (warnings).
const COMPLIANCE_RULES = [
  { file: '.gitignore',    indicates: 'Prevents secrets leaking into source control' },
  { file: '.env.example',  indicates: 'Uses environment variables for configuration'  },
  { file: 'Dockerfile',    indicates: 'Containerised — ready for cloud deployment'    },
  { file: 'SECURITY.md',   indicates: 'Has a security policy'                         },
  { file: 'LICENSE',       indicates: 'Has a software license'                        },
  { file: 'CHANGELOG.md',  indicates: 'Maintains a changelog'                         },
];

module.exports = { LANGUAGE_RULES, CONTENT_RULES, FILE_PRESENCE_RULES, COMPLIANCE_RULES };
