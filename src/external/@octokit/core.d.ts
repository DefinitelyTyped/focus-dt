import { Octokit as Core } from "@octokit/core";
import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
export {};

type OctokitOptions = NonNullable<ConstructorParameters<typeof Core>[0]>;

// Workaround for @octokit/core removing named types for REST API responses
declare module "@octokit/core" {
    interface DefaultTokenAuthOptions extends OctokitOptions {
        auth?: string;
        authStrategy?: undefined;
    }
    interface AuthStrategyOptions<TAuth extends object = object> extends OctokitOptions {
        auth?: TAuth
        authStrategy?: (strategyOptions: { request: Core["request"], log: Core["log"], octokit: Core, octokitOptions: Omit<Options, "authStrategy"> } & TAuth) => () => Promise<{}>;
    }
    type Options = DefaultTokenAuthOptions | AuthStrategyOptions;
    type UsersGetAuthenticatedResponse = RestEndpointMethodTypes["users"]["getAuthenticated"]["response"]["data"];
    type ProjectsListForRepoResponse = RestEndpointMethodTypes["projects"]["listForRepo"]["response"]["data"];
    type ProjectsListForRepoResponseItem = ProjectsListForRepoResponse[number];
    type ProjectsListColumnsResponse = RestEndpointMethodTypes["projects"]["listColumns"]["response"]["data"];
    type ProjectsListColumnsResponseItem = ProjectsListColumnsResponse[number];
    type ProjectsListCardsResponse = RestEndpointMethodTypes["projects"]["listCards"]["response"]["data"];
    type ProjectsListCardsResponseItem = ProjectsListCardsResponse[number];
    type PullsGetResponse = RestEndpointMethodTypes["pulls"]["get"]["response"]["data"];
    type PullsListReviewsResponse = RestEndpointMethodTypes["pulls"]["listReviews"]["response"]["data"];
    type PullsListReviewsResponseItem = PullsListReviewsResponse[number];
    type TeamsListMembersResponse = RestEndpointMethodTypes["teams"]["listMembersInOrg"]["response"]["data"];
    type TeamsListMembersResponseItem = TeamsListMembersResponse[number];
    type PullsGetResponseLabelItem = PullsGetResponse["labels"][number];
    type PullsListCommitsResponse = RestEndpointMethodTypes["pulls"]["listCommits"]["response"]["data"];
    type PullsListCommitsResponseItem = PullsListCommitsResponse[number];
    type ReposListCommitsResponse = RestEndpointMethodTypes["repos"]["listCommits"]["response"]["data"];
    type ReposListCommitsResponseItem = ReposListCommitsResponse[number];
    type IssuesListCommentsResponse = RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"];
    type IssuesListCommentsResponseItem = IssuesListCommentsResponse[number];
}
