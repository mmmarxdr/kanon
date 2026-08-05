const fs = require('fs');
let content = fs.readFileSync('openspec/changes/mcp-large-team-readiness/tasks.md', 'utf8');

// I'll assume they just want the boxes checked
content = content.replace(/- \[ \] 4\.1 RED/g, '- [x] 4.1 RED');
content = content.replace(/- \[ \] 4\.2 GREEN/g, '- [x] 4.2 GREEN');

fs.writeFileSync('openspec/changes/mcp-large-team-readiness/tasks.md', content);
