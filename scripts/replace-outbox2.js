const fs = require('fs');

const routeFile = 'src/app/api/email/send/route.ts';
let routeContent = fs.readFileSync(routeFile, 'utf8');

// The route already has: const user = await getSessionUser();
// So user.tenant_id is available!
routeContent = routeContent.replace(
  /await enqueueEmailOutboxEvent\(\{([\s\S]*?)\}\);/,
  `await enqueueEmailOutboxEvent({$1}, user.tenant_id);`
);

fs.writeFileSync(routeFile, routeContent);
console.log("Done");
