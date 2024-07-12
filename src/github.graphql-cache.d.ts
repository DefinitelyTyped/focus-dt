/* eslint-disable */
/* prettier-ignore */
import type { TadaDocumentNode, $tada } from 'gql.tada';

declare module 'gql.tada' {
 interface setupCache {
    "\n    fragment ProjectV2Fragment on ProjectV2 {\n        __typename\n        number\n        title\n    }\n":
      TadaDocumentNode<{ __typename: "ProjectV2"; number: number; title: string; }, {}, { fragment: "ProjectV2Fragment"; on: "ProjectV2"; masked: true; }>;
    "\n    query ProjectsQuery($owner: String!, $repo: String!, $cursor: String) {\n        repository(owner: $owner, name: $repo) {\n            projectsV2(first: 1, after: $cursor) {\n                nodes { ...ProjectV2Fragment }\n                pageInfo { hasNextPage endCursor }\n            }\n        }\n    }\n":
      TadaDocumentNode<{ repository: { projectsV2: { nodes: { [$tada.fragmentRefs]: { ProjectV2Fragment: "ProjectV2"; }; }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null; }; }; } | null; }, { cursor?: string | null | undefined; repo: string; owner: string; }, void>;
    "\n    fragment ProjectV2ViewFragment on ProjectV2View {\n        __typename\n        number\n        name\n        verticalGroupByFields(first: 1) {\n            nodes {\n                __typename\n                ... on ProjectV2SingleSelectField {\n                    name\n                }\n            }\n        }\n    }\n":
      TadaDocumentNode<{ __typename: "ProjectV2View"; number: number; name: string; verticalGroupByFields: { nodes: ({ __typename: "ProjectV2Field"; } | { __typename: "ProjectV2IterationField"; } | { __typename: "ProjectV2SingleSelectField"; name: string; })[]; } | null; }, {}, { fragment: "ProjectV2ViewFragment"; on: "ProjectV2View"; masked: true; }>;
    "\n    query ProjectV2ViewsQuery($owner: String!, $repo: String!, $project_number: Int!, $cursor: String) {\n        repository(owner: $owner, name: $repo) {\n            projectV2(number: $project_number) {\n                views(first: 1, after: $cursor) {\n                    pageInfo { hasNextPage, endCursor }\n                    nodes { ...ProjectV2ViewFragment }\n                }\n            }\n        }\n    }\n":
      TadaDocumentNode<{ repository: { projectV2: { views: { pageInfo: { hasNextPage: boolean; endCursor: string | null; }; nodes: { [$tada.fragmentRefs]: { ProjectV2ViewFragment: "ProjectV2View"; }; }[]; }; } | null; } | null; }, { cursor?: string | null | undefined; project_number: number; repo: string; owner: string; }, void>;
    "\n    fragment PullRequestFragment on PullRequest {\n        __typename\n        number\n        url\n        updatedAt\n        state\n        title\n        author { login }\n        labels(first: 20) {\n            nodes {\n                name\n                color\n            }\n        }\n        headRefOid\n        headRepository {\n            owner {\n                login\n            }\n            name\n        }\n        isDraft\n        mergeable\n        commits {\n            totalCount\n        }\n    }\n":
      TadaDocumentNode<{ __typename: "PullRequest"; number: number; url: string; updatedAt: string; state: "CLOSED" | "MERGED" | "OPEN"; title: string; author: { __typename?: "Bot" | undefined; login: string; } | { __typename?: "EnterpriseUserAccount" | undefined; login: string; } | { __typename?: "Mannequin" | undefined; login: string; } | { __typename?: "Organization" | undefined; login: string; } | { __typename?: "User" | undefined; login: string; } | null; labels: { nodes: ({ name: string; color: string; } | null)[] | null; } | null; headRefOid: string; headRepository: { owner: { __typename?: "Organization" | undefined; login: string; } | { __typename?: "User" | undefined; login: string; }; name: string; } | null; isDraft: boolean; mergeable: "CONFLICTING" | "MERGEABLE" | "UNKNOWN"; commits: { totalCount: number; }; }, {}, { fragment: "PullRequestFragment"; on: "PullRequest"; masked: true; }>;
    "\n    query ProjectItems($owner: String!, $repo: String!, $project_number: Int!, $column_field: String!, $cursor: String) {\n        repository(owner: $owner, name: $repo) {\n            projectV2(number: $project_number) {\n                items(first: 20, after: $cursor) {\n                    pageInfo { hasNextPage endCursor }\n                    nodes {\n                        __typename\n                        fieldValueByName(name: $column_field) {\n                            ... on ProjectV2ItemFieldSingleSelectValue {\n                                __typename\n                                name\n                            }\n                        }\n                        content { ... PullRequestFragment }\n                    }\n                }\n            }\n        }\n    }\n":
      TadaDocumentNode<{ repository: { projectV2: { items: { pageInfo: { hasNextPage: boolean; endCursor: string | null; }; nodes: { __typename: "ProjectV2Item"; fieldValueByName: { __typename?: "ProjectV2ItemFieldDateValue" | undefined; } | { __typename?: "ProjectV2ItemFieldIterationValue" | undefined; } | { __typename?: "ProjectV2ItemFieldLabelValue" | undefined; } | { __typename?: "ProjectV2ItemFieldMilestoneValue" | undefined; } | { __typename?: "ProjectV2ItemFieldNumberValue" | undefined; } | { __typename?: "ProjectV2ItemFieldPullRequestValue" | undefined; } | { __typename?: "ProjectV2ItemFieldRepositoryValue" | undefined; } | { __typename?: "ProjectV2ItemFieldReviewerValue" | undefined; } | { __typename: "ProjectV2ItemFieldSingleSelectValue"; name: string | null; } | { __typename?: "ProjectV2ItemFieldTextValue" | undefined; } | { __typename?: "ProjectV2ItemFieldUserValue" | undefined; } | null; content: { __typename?: "PullRequest" | undefined; [$tada.fragmentRefs]: { PullRequestFragment: "PullRequest"; }; } | { __typename?: "DraftIssue" | undefined; } | { __typename?: "Issue" | undefined; } | null; }[]; }; } | null; } | null; }, { cursor?: string | null | undefined; column_field: string; project_number: number; repo: string; owner: string; }, void>;
    "\n    query PullRequest($owner: String!, $repo: String!, $pull_number: Int!) {\n        repository(owner: $owner, name: $repo) {\n            pullRequest(number: $pull_number) { ...PullRequestFragment }\n        }\n    }\n":
      TadaDocumentNode<{ repository: { pullRequest: { [$tada.fragmentRefs]: { PullRequestFragment: "PullRequest"; }; } | null; } | null; }, { pull_number: number; repo: string; owner: string; }, void>;
  }
}
