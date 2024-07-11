import type { RequestParameters } from "@octokit/graphql/types";
import { type TadaDocumentNode } from "gql.tada";
import { print } from "graphql";
import type { Octokit } from "octokit";
import type { introspection } from "./graphql-env.js"

export type GitHubGQLFunc = <R, V extends Record<string, unknown>>(
  query: TadaDocumentNode<R, V>,
  variables?: RequestParameters & V,
) => Promise<R>;

export type GitHubGQLPaginateIteratorFunc = <R, V extends Record<string, unknown>>(
  query: TadaDocumentNode<R, V>,
  variables?: RequestParameters & V,
) => AsyncIterable<R>;

export type GitHubGQL = GitHubGQLFunc & {
  paginate: GitHubGQLPaginate;
};

export type GitHubGQLPaginate = GitHubGQLFunc & {
  iterator: GitHubGQLPaginateIteratorFunc;
};

export type GQLResult<T> = T extends TadaDocumentNode<infer R, any, any> ? R : never;

export function createGitHubGQL(octokit: Octokit): GitHubGQL {
  const gitHubGQLFunction: GitHubGQLFunc = (query, variables) =>
    octokit["graphql"]<GQLResult<typeof query>>(print(query), variables);

  const paginateFunction: GitHubGQLFunc = (query, variables) =>
    octokit.graphql.paginate<GQLResult<typeof query> & object>(
      print(query),
      variables,
    );

  const iteratorFunction: GitHubGQLPaginateIteratorFunc = async function* (
    query,
    variables,
  ) {
    const iterator = octokit.graphql.paginate.iterator<GQLResult<typeof query>>(
      print(query),
      variables,
    );
    for await (const response of iterator) {
      yield response;
    }
  };

  const gitHubGQL = gitHubGQLFunction as GitHubGQL;
  gitHubGQL.paginate = paginateFunction as GitHubGQLPaginate;
  gitHubGQL.paginate.iterator = iteratorFunction;

  return gitHubGQL;
}
