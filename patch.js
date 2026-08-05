const fs = require('fs');
const content = fs.readFileSync('packages/api/src/modules/issue/routes.ts', 'utf8');

const importReplacement = `import {
  CreateIssueBody,
  UpdateIssueBody,
  TransitionBody,
  BatchTransitionBody,
  BatchTransitionByKeysBody,
  ProjectKeyParam,
  IssueKeyParam,
  GroupKeyParam,
  IssueFilterQuery,
  ReconcileTimeBody,
} from "./schema.js";
import { IssueSearchInputSchema } from "../triage/contracts.js";
import { requireWorkspaceMember } from "../../middleware/require-role.js";
import { searchIssues } from "../triage/search.js";`;

let newContent = content.replace(/import \{[\s\S]*?\} from "\.\/schema\.js";/, importReplacement);

const newRoute = `
  /**
   * POST /api/workspaces/:workspaceId/issue-search.v1
   */
  app.post(
    "/workspaces/:workspaceId/issue-search.v1",
    {
      preHandler: [requireWorkspaceMember("workspaceId")],
      schema: {
        params: z.object({ workspaceId: z.string() }),
        body: IssueSearchInputSchema,
      },
    },
    async (request, reply) => {
      const response = await searchIssues(
        request.params.workspaceId,
        request.member!.id,
        request.body
      );
      return reply.status(200).send(response);
    }
  );
`;

// we need to add z from zod if not there
if (!newContent.includes('import { z }')) {
  newContent = `import { z } from "zod";\n` + newContent;
}

newContent = newContent.replace('export default async function issueRoutes(', newRoute + '\nexport default async function issueRoutes(');

fs.writeFileSync('packages/api/src/modules/issue/routes.ts', newContent);
