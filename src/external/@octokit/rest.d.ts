import { Octokit, RestEndpointMethodTypes, RestEndpointMethodTypes } from "@octokit/rest";

// Workaround for @octokit/rest removing named types for REST API responses
declare module "@octokit/rest" {
    namespace Octokit {
        type Options = NonNullable<ConstructorParameters<typeof Octokit>[0]>;
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
}
