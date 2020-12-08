import { from } from "iterable-query";
import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";

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
    }
}

/** A GitHub Project Board */
export interface Project extends Octokit.ProjectsListForRepoResponseItem {}

/** A Column in a GitHub Project Board */
export interface Column extends Octokit.ProjectsListColumnsResponseItem {}

/** A Card in a GitHub Project Board */
export interface Card extends Octokit.ProjectsListCardsResponseItem {}

/** A GitHub Pull Request, with some additional options */
export interface Pull extends Octokit.PullsGetResponse {
    /** Indicates whether the authenticated user has approved the PR */
    approvedByMe?: boolean;
    /** Indicates whether all reviews are currently approvals */
    approvedByAll?: boolean;
    /** Review state for any team members */
    teamMembersWithReviews?: TeamMemberReviewState[];
    /** Status message lines from the DT bot */
    botStatus?: string[];
}

/** A GitHub Label */
export interface Label extends Octokit.PullsGetResponseLabelItem {
    name: string;
}

/**
 * A Team Member's review state
 */
export interface TeamMemberReviewState {
    /** The GitHub Login for the team member */
    login: string;
    /** The review state (COMMENT and PENDING reviews are ignored) */
    state: "APPROVED" | "CHANGES_REQUESTED";
    /** The date the review was submitted in ISO8601-format */
    submitted_at: string;
}

/**
 * The result of getting a pull request successfully.
 */
export interface GetPullSuccessResult {
    error: false;
    pull: Pull;
    labels: Label[];
}

/**
 * The result when failing to get a pull request.
 */
export interface GetPullFailureResult {
    error: true;
    message: string;
}

export type GetPullResult = GetPullSuccessResult | GetPullFailureResult;

/**
 * Options for our GitHub wrapper
 */
export interface ProjectServiceOptions<K extends string> {
    /** Options for the GitHub REST API */
    github: Octokit.Options;
    /** Owner of the Repo to run down */
    owner: string;
    /** Repo to run down */
    repo: string;
    /** Team slug to use for a list of maintainers */
    team?: string;
    /** Name of the Project Board to use for PR rundown. */
    project?: string;
    /** Names of the Project Board columns to use for PR rundown. */
    columns?: readonly K[];
}

// TODO: Make this configurable or something because we keep changing it...
export class ProjectService<K extends string> {
    static readonly defaultProject = "New Pull Request Status Board";
    static readonly defaultColumns = ["Needs Maintainer Review", "Needs Maintainer Action"] as const;

    private _github: Octokit;
    private _ownerAndRepo: { owner: string, repo: string };
    private _team: string | undefined;
    private _projectName: string;
    private _columnNames: readonly K[];
    private _columns: Record<K, Column> | null | undefined;
    private _project: Octokit.ProjectsListForRepoResponseItem | null | undefined;
    private _user: Octokit.UsersGetAuthenticatedResponse | null | undefined;
    private _teamMembers: Octokit.TeamsListMembersResponseItem[] | null | undefined;

    constructor(options: ProjectServiceOptions<K>) {
        this._github = new Octokit(options.github);
        const {
            owner,
            repo,
            team,
            project = ProjectService.defaultProject,
            columns = ProjectService.defaultColumns,
        } = options;
        this._projectName = project;
        this._columnNames = columns as readonly K[];
        this._ownerAndRepo = { owner, repo };
        this._team = team;
    }

    /**
     * Gets the current authenticated user.
     */
    async getAuthenticatedUser(): Promise<Octokit.UsersGetAuthenticatedResponse | undefined> {
        if (this._user === undefined) {
            try {
                const { data: user } = await this._github.users.getAuthenticated();
                this._user = user || null;
            }
            catch {
                this._user = null;
            }
        }
        return this._user || undefined;
    }

    /**
     * Lists members of the provided team.
     */
    async listTeamMembers(): Promise<Octokit.TeamsListMembersResponseItem[] | undefined> {
        if (this._teamMembers === undefined && this._team) {
            try {
                const { data: members } = await this._github.teams.listMembersInOrg({ org: this._ownerAndRepo.owner, team_slug: this._team });
                this._teamMembers = members?.length ? members : null;
            }
            catch {
                this._teamMembers = null;
            }
        }
        return this._teamMembers || undefined;
    }

    /**
     * Gets the project board.
     */
    async getProject() {
        if (this._project === undefined) {
            try {
                const { data: projects } = await this._github.projects.listForRepo({ ...this._ownerAndRepo, state: "open" });
                this._project = projects.find(proj => proj.name === this._projectName) || null;
            }
            catch (e) {
                this._project = null;
                throw e;
            }
        }
        if (!this._project) {
            throw new Error(`Could not find project '${this._projectName}'.`);
        }
        return this._project;
    }

    /**
     * Gets the project board columns.
     */
    async getColumns() {
        const project = await this.getProject();
        if (this._columns === undefined) {
            const { data: columnList } = await this._github.projects.listColumns({ project_id: project.id });
            const columns: Record<K, Column> = Object.create(null);
            const requestedColumns = new Set<string>(this._columnNames);
            for (const col of columnList) {
                if (requestedColumns.has(col.name)) {
                    requestedColumns.delete(col.name);
                    columns[col.name as K] = col;
                }
            }
            for (const key of requestedColumns.keys()) {
                this._columns = null;
                throw new Error(`Could not find '${key}' column.`);
            }
            this._columns = columns;
        }
        if (!this._columns) {
            throw new Error(`Could not resolve columns`);
        }
        return this._columns;
    }

    /**
     * Gets the cards in a project board column.
     * @param column The column to retrieve.
     * @param oldestFirst Whether to retrieve the oldest cards first.
     */
    async getCards(column: Column, oldestFirst: boolean) {
        let cards: Card[] = [];
        let pageNum = 0;
        while (true) {
            const page = (await this._github.projects.listCards({
                column_id: column.id,
                per_page: 30,
                page: pageNum
            })).data;
            cards = cards.concat(page);
            if (page.length < 30) break;
            pageNum++;
        }
        return from(cards)
            .distinctBy(card => card.id)
            .where(card => !card.archived)
            .through(q => oldestFirst
                ? q.orderBy(card => card.updated_at)
                : q.orderByDescending(card => card.updated_at))
            .toArray();
    }

    /**
     * Gets the pull request associated with a card.
     * @param card The project board card.
     * @param includeDrafts Whether to include Draft PRs
     * @param includeWip Whether to include PRs marked WIP
     * @param exclude A map of PR numbers to exclude to the Date they were excluded (in milliseconds since the UNIX epoch)
     * @param excludeTimeout A window in which updates to an excluded PR should be ignored before the PR should no longer be considered excluded.
     */
    async getPull(card: Card, includeDrafts?: boolean, includeWip?: boolean, exclude?: Map<number, number>, excludeTimeout = 0): Promise<GetPullResult> {
        const match = /(\d+)$/.exec(card.content_url || "");
        if (!match) {
            return { error: true, message: "Could not determine pull number" };
        }

        const { data: pull } = await this._github.pulls.get({ ...this._ownerAndRepo, pull_number: +match[1] });
        if (pull.state === "closed") {
            return { error: true, message: `'${pull.title.trim()}' is closed` };
        }

        if ((pull.draft || pull.mergeable_state === "draft") && !includeDrafts) {
            return { error: true, message: `'${pull.title.trim()}' is a draft and is not yet ready for review` };
        }

        if (/\bwip\b/i.test(pull.title) && !includeWip) {
            return { error: true, message: `'${pull.title.trim()}' is a work-in-progress and is not yet ready for review` };
        }

        const labels = new Map(pull.labels
            .filter((label): label is Label => !!label.name)
            .map(label => [label.name!, label])
        );

        if (labels.has("Revision needed")) {
            return { error: true, message: `'${pull.title.trim()}' is awaiting revisions` };
        }

        let excludeTimestamp = exclude?.get(pull.number);
        if (excludeTimestamp && Date.parse(pull.updated_at) < excludeTimestamp + excludeTimeout) {
            return { error: true, message: `'${pull.title.trim()}' was previously skipped` };
        }

        const me = await this.getAuthenticatedUser();
        const reviews = await this.listReviews(pull);
        const teamMembers = await this.listTeamMembers();

        // Search for the typescript-bot comment
        const { data: comments } = await this._github.issues.listComments({
            ...this._ownerAndRepo,
            issue_number: pull.number
        });

        // TODO: Make this configurable as well
        const botComment = comments.find(comment =>
            comment.user?.login === "typescript-bot" &&
            /<!--typescript_bot_welcome-->/i.test(comment.body || "")
        );

        let botStatus: string[] | undefined;
        const body = botComment?.body;
        if (body) {
            const match = /## Status(?:\r?\n)+((?:\s\*.*?(?:\r?\n))*)/.exec(body);
            if (match) {
                botStatus = match[1]
                    .replace(/\[(.*?)\]\(.*?\)/, (_, s) => s)
                    .split(/\r?\n/g)
                    .map(s => ' ' + s.trim());
            }
        }

        const approvedByAll = ProjectService.isApprovedByAllCore(reviews);
        const approvedByMe = ProjectService.isApprovedByMeCore(me, reviews);
        const teamMembersWithRequestedChanges = ProjectService.teamMembersWithReviewsCore(teamMembers, reviews);
        return { error: false, pull: { ...pull, approvedByMe, approvedByAll, teamMembersWithReviews: teamMembersWithRequestedChanges, botStatus }, labels: [...labels.values()] };
    }

    private async listReviews(pull: Pull) {
        const { data: reviews } = await this._github.pulls.listReviews({ ...this._ownerAndRepo, pull_number: pull.number });
        return reviews?.length ? reviews : null;
    }

    private static reviewIsApproved(review: Octokit.PullsListReviewsResponseItem): review is typeof review & { state: "APPROVED" } {
        return review.state === "APPROVED";
    }

    private static reviewHasChangesRequested(review: Octokit.PullsListReviewsResponseItem): review is typeof review & { state: "CHANGES_REQUESTED" } {
        return review.state === "CHANGES_REQUESTED";
    }

    private static latestReviews(reviews: Octokit.PullsListReviewsResponse | null | undefined) {
        if (reviews) {
            const lastReviewStates = new Map<string, Octokit.PullsListReviewsResponseItem>();
            for (const review of reviews) {
                if (!review.user || !review.submitted_at) continue;
                const lastReview = lastReviewStates.get(review.user.login);
                if (!lastReview || lastReview.submitted_at! < review.submitted_at) {
                    lastReviewStates.set(review.user.login, review);
                }
            }
            const results = [...lastReviewStates.values()];
            if (results.length > 0) {
                results.sort((a, b) => a.submitted_at! < b.submitted_at! ? -1 : a.submitted_at! > b.submitted_at! ? 1 : 0);
                return results;
            }
        }
        return null;
    }

    private static isApprovedByAllCore(reviews: Octokit.PullsListReviewsResponse | null | undefined) {
        return ProjectService.latestReviews(reviews)?.every(ProjectService.reviewIsApproved) ?? false;
    }

    private static isApprovedByMeCore(me: Octokit.UsersGetAuthenticatedResponse | null | undefined, reviews: Octokit.PullsListReviewsResponse | null | undefined) {
        return me && ProjectService.latestReviews(reviews)?.some(review => ProjectService.reviewIsApproved(review) && review.user?.id === me.id) || false;
    }

    private static teamMembersWithReviewsCore(teamMembers: Octokit.TeamsListMembersResponseItem[] | null | undefined, reviews: Octokit.PullsListReviewsResponse | null | undefined) {
        const memberIds = teamMembers && new Set(teamMembers.map(member => member?.id).filter((id): id is number => typeof id === "number"));
        reviews = memberIds && ProjectService.latestReviews(reviews);
        if (memberIds && reviews) {
            const result: TeamMemberReviewState[] = [];
            for (const review of reviews) {
                if (!review.user || !memberIds.has(review.user.id)) continue;
                if (ProjectService.reviewHasChangesRequested(review) ||
                    ProjectService.reviewIsApproved(review)) {
                    result.push({ login: review.user.login, state: review.state, submitted_at: review.submitted_at! });
                }
            }
            if (result.length) return result;
        }
    }

    /**
     * Determines whether a pull has at least one review and that all reviews are marked APPROVED.
     */
    async isApprovedByAll(pull: Pull): Promise<boolean> {
        return ProjectService.isApprovedByAllCore(await this.listReviews(pull));
    }

    /**
     * Determines whether a pull has been approved by the authenticated user.
     */
    async isApprovedByMe(pull: Pull): Promise<boolean> {
        const [me, reviews] = await Promise.all([this.getAuthenticatedUser(), this.listReviews(pull)]);
        return ProjectService.isApprovedByMeCore(me, reviews);
    }

    /**
     * Returns a list of reviews from team members for a pull.
     */
    async teamMembersWithReviews(pull: Pull): Promise<TeamMemberReviewState[] | undefined> {
        const [teamMembers, reviews] = await Promise.all([this.listTeamMembers(), this.listReviews(pull)]);
        return ProjectService.teamMembersWithReviewsCore(teamMembers, reviews);
    }

    /**
     * Approves a pull.
     */
    async approvePull(pull: Pull): Promise<void> {
        const me = await this.getAuthenticatedUser();
        if (ProjectService.isApprovedByMeCore(me, await this.listReviews(pull))) {
            return;
        }

        const { data: review } = await this._github.pulls.createReview({
            ...this._ownerAndRepo,
            pull_number: pull.number,
        });
        if (!review) return;

        await this._github.pulls.submitReview({
            ...this._ownerAndRepo,
            pull_number: pull.number,
            event: "APPROVE",
            review_id: review.id
        });

        const teamMembers = await this.listTeamMembers();
        const reviews = await this.listReviews(pull);
        pull.approvedByMe = ProjectService.isApprovedByMeCore(me, reviews);
        pull.approvedByAll = ProjectService.isApprovedByAllCore(reviews);
        pull.teamMembersWithReviews = ProjectService.teamMembersWithReviewsCore(teamMembers, reviews);
    }

    /**
     * Merges a pull.
     */
    async mergePull(pull: Pull, method?: "merge" | "squash" | "rebase"): Promise<void> {
        await this._github.pulls.merge({
            ...this._ownerAndRepo,
            pull_number: pull.number,
            merge_method: method
        });
    }
}