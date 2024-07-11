import type {} from "./graphql-env.js";
import { AsyncQuery, fn, from, fromAsync } from "iterable-query";
import { IssuesListCommentsResponseItem, Options, ProjectsListCardsResponseItem, ProjectsListColumnsResponseItem, ProjectsListForRepoResponseItem, PullsGetResponse, PullsGetResponseLabelItem, PullsListCommitsResponseItem, PullsListReviewsResponseItem, ReposListCommitsResponseItem, TeamsListMembersResponse, TeamsListMembersResponseItem, UsersGetAuthenticatedResponse } from "@octokit/rest";
import { Octokit } from "octokit";
import { type GraphQlQueryResponse, type GraphQlResponse, type RequestParameters } from "@octokit/graphql/types";
import { approveGitCredential, GitCredential, GitUrlCredential, rejectGitCredential } from "./credentialManager.js";
import { createGitHubGQL, GitHubGQL } from "./graphql.js";
import { graphql } from "gql.tada";

const MAX_EXCLUDE_TIMEOUT = 1000 * 60 * 60 * 24 * 7; // check back at least once every 7 days...

/** A GitHub Project Board */
export interface Project extends ProjectsListForRepoResponseItem {}

/** A Column in a GitHub Project Board */
export interface Column extends ProjectsListColumnsResponseItem {}

/** A Card in a GitHub Project Board */
export interface Card extends ProjectsListCardsResponseItem {}

export interface Comment extends IssuesListCommentsResponseItem {}

/** A GitHub Pull Request, with some additional options */
export interface Pull extends PullsGetResponse {
    /** Indicates whether the authenticated user has approved the most recent commit to this PR */
    approvedByMe?: boolean | "outdated";
    /** The authenticated user's review for the PR */
    myReview?: Review;
    /** Indicates whether an owner for each package has approved the most recent commit to this PR */
    approvedByOwners?: boolean | "outdated";
    /** Review state for any package owners */
    ownerReviews?: Review[];
    /** Indicates whether any maintainer has approved the most recent commit to this PR. */
    approvedByMaintainer?: boolean | "outdated";
    /** Review state for any team members */
    maintainerReviews?: Review[];
    /** The bot welcome comment */
    botWelcomeComment?: Comment;
    /** Status message lines from the DT bot welcome comment */
    botStatus?: string[];
    /** JSON data included in the DT bot welcome comment */
    botData?: BotData;
    /** Indicates whether the PR supports self-merge */
    supportsSelfMerge?: boolean;
    /** A list of the most recent commits since the last time the PR was skipped. */
    recentCommits?: Commit[];
    /** The last commit to the PR */
    lastCommit?: Commit;
    /** A list of the most recent comments since the last time the PR was skipped. */
    recentComments?: Comment[];
    /** The last comment to the PR */
    lastComment?: Comment;
    /** Date the PR was last updated by a non-bot user */
    lastUpdatedAt?: string;
}

/** A GitHub Pull Request Review */
export interface Review extends PullsListReviewsResponseItem {
    state: "APPROVED" | "CHANGES_REQUESTED";
    user: PullsListReviewsResponseItem["user"] & { login: string };
    ownerReviewFor?: string[];
    myReview?: boolean;
    maintainerReview?: boolean;
    isOutdated?: boolean;
}

/** A Commit in a GitHub Repo or Pull Request */
export interface Commit extends PullsListCommitsResponseItem, ReposListCommitsResponseItem {
}

/** A GitHub Label */
export interface Label extends PullsGetResponseLabelItem {
    name: string;
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

export interface BotData {
    type: string;
    now: string;
    pr_number: number;
    author: string;
    headCommitAbbrOid: string,
    headCommitOid: string,
    lastPushDate: string,
    lastActivityDate: string,
    maintainerBlessed: boolean,
    hasMergeConflict: boolean,
    isFirstContribution: boolean,
    popularityLevel: string,
    pkgInfo: {
        name: string,
        kind: string,
        files: {
            path: string,
            kind: string
        }[],
        owners: string[],
        addedOwners: [],
        deletedOwners: [],
        popularityLevel: string
    }[],
    reviews: {
        type: string,
        reviewer: string,
        date: string,
        abbrOid: string
    }[],
    ciResult: string
}

/**
 * Options for our GitHub wrapper
 */
export interface ProjectServiceOptions<K extends string> {
    credential?: GitCredential | GitUrlCredential;
    /** Options for the GitHub REST API */
    github: Options;
    /** Owner of the Repo to run down */
    owner: string;
    /** Repo to run down */
    repo: string;
    /** Team slug to use for a list of maintainers */
    team?: string;
    /** Name of the Project Board to use for PR rundown. */
    project?: string;
    classicProjects?: boolean;
    /** Names of the Project Board columns to use for PR rundown. */
    columns?: readonly K[];
}

// TODO: Make this configurable or something because we keep changing it...
export class ProjectService<K extends string> {
    static readonly defaultProject = "Pull Request Status Board";
    static readonly defaultColumns = ["Needs Maintainer Review", "Needs Maintainer Action"] as const;

    private _credential?: GitCredential | GitUrlCredential;
    private _github: Octokit;
    private _ownerAndRepo: { owner: string, repo: string };
    private _classicProjects = false;
    private _team: string | undefined;
    private _projectName: string;
    private _columnNames: readonly K[];
    private _columns: Record<K, Column> | null | undefined;
    private _project: Pick<ProjectsListForRepoResponseItem, "id"> | null | undefined;
    private _user: UsersGetAuthenticatedResponse | null | undefined;
    private _teamMembers: TeamsListMembersResponseItem[] | null | undefined;
    private _graphql: GitHubGQL;

    constructor(options: ProjectServiceOptions<K>) {
        this._credential = options.credential;
        this._github = new Octokit(options.github);
        const {
            owner,
            repo,
            project = ProjectService.defaultProject,
            classicProjects = false,
            columns = ProjectService.defaultColumns,
            team,
        } = options;
        this._projectName = project;
        this._columnNames = columns as readonly K[];
        this._ownerAndRepo = { owner, repo };
        this._classicProjects = classicProjects;
        this._team = team;
        this._graphql = createGitHubGQL(this._github);
    }

    private static isReview(review: PullsListReviewsResponseItem): review is Review {
        return !!review.user?.login
            && (ProjectService.reviewIsApproved(review) || ProjectService.reviewHasChangesRequested(review));
    }

    private static reviewIsApproved(review: PullsListReviewsResponseItem): review is typeof review & { state: "APPROVED" } {
        return review.state === "APPROVED";
    }

    private static reviewHasChangesRequested(review: PullsListReviewsResponseItem): review is typeof review & { state: "CHANGES_REQUESTED" } {
        return review.state === "CHANGES_REQUESTED";
    }

    private static latestReviews(reviews: Review[] | null | undefined) {
        if (reviews) {
            const lastReviewStates = new Map<string, Review>();
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

    private static getOwnerReviewsCore(reviews: Review[] | null | undefined, botData: BotData | undefined, since?: string) {
        if (!reviews || !botData) return undefined;
        const reviewsByUser = new Map(from(reviews)
            .groupBy(review => review.user?.login || "", fn.identity, (login, reviews) => [login, ProjectService.latestReviews(reviews.toArray())?.[0]]));
        const ownerReviews = new Set<Review>();
        const packageReviews = new Set<string>();
        for (const packageInfo of botData.pkgInfo) {
            for (const owner of new Set(packageInfo.owners)) {
                const review = reviewsByUser.get(owner);
                if (!review) continue;
                if (!(ProjectService.reviewHasChangesRequested(review) || (!since || (review.submitted_at ?? "") >= since))) continue;
                review.ownerReviewFor ??= [];
                review.ownerReviewFor.push(packageInfo.name);
                ownerReviews.add(review);
                packageReviews.add(packageInfo.name);
            }
        }
        return ownerReviews.size ? [...ownerReviews] : undefined;
    }

    private static getMyReviewCore(me: UsersGetAuthenticatedResponse | null | undefined, reviews: Review[] | null | undefined) {
        const review = me ? ProjectService.latestReviews(reviews)?.find(review => review.user.id === me.id) : undefined;
        if (review) review.myReview = true;
        return review;
    }

    private static getMaintainerReviewsCore(maintainers: TeamsListMembersResponseItem[] | null | undefined, reviews: Review[] | null | undefined) {
        const maintainerIds = maintainers && new Set(maintainers.map(member => member?.id).filter((id): id is number => typeof id === "number"));
        if (maintainerIds) {
            reviews = ProjectService.latestReviews(reviews);
            if (reviews) {
                let result: Review[] | undefined;
                for (const review of reviews) {
                    if (!maintainerIds.has(review.user.id)) continue;
                    review.maintainerReview = true;
                    result ??= [];
                    result.push(review);
                }
                return result;
            }
        }
    }

    private static pickMostRelevantReview(left: Review | undefined, right: Review) {
        if (!left || left === right) return right;
        if (left.state !== right.state) {
            // CHANGES_REQUESTED trumps APPROVED unless the CHANGES_REQUESTED is outdated and the APPROVED is not.
            if (left.state === "CHANGES_REQUESTED") {
                return !left.isOutdated || right.isOutdated ? left : right;
            }
            else {
                return !right.isOutdated || left.isOutdated ? right : left;
            }
        }
        return (left.submitted_at || "") > (right.submitted_at || "") ? left : right;
    }

    private static updatePullStatus(pull: Pull, reviews: Review[] | null | undefined, me: UsersGetAuthenticatedResponse | undefined, maintainers: TeamsListMembersResponse | undefined) {
        reviews = ProjectService.latestReviews(reviews);
        pull.approvedByMe = false;
        if (pull.myReview = ProjectService.getMyReviewCore(me, reviews)) {
            if (ProjectService.reviewIsApproved(pull.myReview)) {
                pull.approvedByMe = pull.myReview.isOutdated ? "outdated" : true;
            }
        }

        pull.approvedByOwners = false;
        pull.ownerReviews = ProjectService.getOwnerReviewsCore(reviews, pull.botData);
        if (pull.ownerReviews && pull.botData) {
            const packageReviews = new Map<string, Review>();
            for (const review of pull.ownerReviews) {
                if (!review.ownerReviewFor) continue;
                for (const packageName of review.ownerReviewFor) {
                    const candidateReview = packageReviews.get(packageName);
                    const relevantReview = ProjectService.pickMostRelevantReview(candidateReview, review);
                    if (relevantReview !== candidateReview) packageReviews.set(packageName, relevantReview);
                }
            }
            if (packageReviews.size === pull.botData.pkgInfo.length) {
                for (const review of packageReviews.values()) {
                    if (review.state === "CHANGES_REQUESTED") {
                        pull.approvedByOwners = false;
                        break;
                    }
                    if (review.state === "APPROVED") {
                        if (review.isOutdated) {
                            pull.approvedByOwners = "outdated";
                            break;
                        }
                        pull.approvedByOwners = true;
                    }
                }
            }
        }

        pull.approvedByMaintainer = false;
        pull.maintainerReviews = ProjectService.getMaintainerReviewsCore(maintainers, reviews);
        if (pull.maintainerReviews) {
            const lastMaintainerReview = from(pull.maintainerReviews).last();
            if (lastMaintainerReview) {
                pull.approvedByMaintainer =
                    lastMaintainerReview.state === "CHANGES_REQUESTED" ? false :
                    lastMaintainerReview.isOutdated ? "outdated" :
                    true;
            }
        }
    }

    private _requestSucceeded(): void {
        const credential = this._credential;
        if (credential) {
            this._credential = undefined;
            approveGitCredential(credential);
        }
    }

    private _requestFailed(): void {
        const credential = this._credential;
        if (credential) {
            this._credential = undefined;
            rejectGitCredential(credential);
        }
    }

    private async _checkResponseWorker<T>(value: Promise<T>) {
        let ok = false;
        try {
            const result = await value;
            ok = true;
            return result;
        }
        finally {
            if (ok) {
                this._requestSucceeded();
            }
            else {
                this._requestFailed();
            }
        }
    }

    private _checkResponse<T>(value: Promise<T>) {
        return this._credential ? this._checkResponseWorker(value) : value;
    }

    /**
     * Gets the current authenticated user.
     */
    async getAuthenticatedUser(): Promise<UsersGetAuthenticatedResponse | undefined> {
        if (this._user === undefined) {
            try {
                const { data: user } = await this._checkResponse(this._github.rest.users.getAuthenticated());
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
    async listMaintainers(): Promise<TeamsListMembersResponseItem[] | undefined> {
        if (this._teamMembers === undefined && this._team) {
            try {
                const members = await this._checkResponse(fromAsync(this._github.paginate.iterator(this._github.rest.teams.listMembersInOrg,
                    {
                        org: this._ownerAndRepo.owner,
                        team_slug: this._team
                    }))
                    .selectMany(response => response.data)
                    .whereDefined()
                    .toArray());
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
                if (this._classicProjects) {
                    const response = this._github.rest.projects.listForRepo({ ...this._ownerAndRepo, state: "open" });
                    const { data: projects } = await this._checkResponse(response);
                    this._project = projects.find(proj => proj.name === this._projectName) || null;
                }
                else {
                    const projects = await this._checkResponse(fromAsync(
                        this._graphql.paginate.iterator(graphql(`
                            query Projects($owner: String!, $repo: String!, $cursor: String) {
                                repository(owner: $owner, name: $repo) {
                                    projectsV2(first: 20, after: $cursor) {
                                        nodes {
                                            number
                                            title
                                        }
                                        pageInfo {
                                            hasNextPage
                                            endCursor
                                        }
                                    }
                                }
                            }
                        `), { ...this._ownerAndRepo })
                    )
                        .selectMany(response => response.repository?.projectsV2.nodes ?? [])
                        .where(project => !!project)
                        .toArray());
                    const project = projects.find(proj => proj?.title == this._projectName);
                    this._project = project && { id: project.number };
                }
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
            if (this._classicProjects) {
                const columnList = await fromAsync(this._github.paginate.iterator(this._github.rest.projects.listColumns, { project_id: project.id }))
                    .selectMany(response => response.data)
                    .toArray();
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
            else {
                // HACK: This is a workaround due to the confusing API for projectsV2
                this._columns = {} as Record<K, Column>;
                for (const columnName of this._columnNames) {
                    this._columns[columnName] = { name: columnName as string } as Column;
                }
            }
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
        if (this._classicProjects) {
            return await this._checkResponse(fromAsync(this._github.paginate.iterator(this._github.rest.projects.listCards, { column_id: column.id }))
                .selectMany(response => response.data)
                .distinctBy(card => card.id)
                .where(card => !card.archived)
                [oldestFirst ? "orderBy" : "orderByDescending"](card => card.updated_at)
                .toArray());
        }
        else {
            // TODO: "View" should be queried from project
            // TODO: "Status" field should be queried from view's verticalGroupByFields
            const project = await this.getProject();
            return await this._checkResponse(fromAsync(
                this._graphql.paginate.iterator(graphql(`
                    query Cards($owner: String!, $repo: String!, $project_id: Int!, $cursor: String) {
                        repository(owner: $owner, name: $repo) {
                            projectV2(number: $project_id) {
                                items(first: 20, after: $cursor) {
                                    nodes {
                                        fieldValueByName(name: "Status") {
                                            ... on ProjectV2ItemFieldSingleSelectValue {
                                                name
                                            }
                                        }
                                        content {
                                            ... on PullRequest {
                                                number
                                                url
                                                updatedAt
                                            }
                                        }
                                    }
                                    pageInfo {
                                        hasNextPage
                                        endCursor
                                    }
                                }
                            }
                        }
                    }
                `), { ...this._ownerAndRepo, project_id: project.id })
            )
                .selectMany(response => response.repository?.projectV2?.items.nodes ?? [])
                .select(node =>
                    !!node &&
                    !!node.fieldValueByName &&
                    "name" in node.fieldValueByName &&
                    node.fieldValueByName.name === column.name &&
                    !!node.content &&
                    "number" in node.content &&
                    "url" in node.content &&
                    "updatedAt" in node.content ? {
                        id: node.content.number,
                        content_url: node.content.url,
                        updated_at: node.content.updatedAt,
                    } as Card :
                    undefined
                )
                .where(node => !!node)
                .distinctBy(card => card.id)
                .where(card => !card.archived)
                [oldestFirst ? "orderBy" : "orderByDescending"](card => card.updated_at)
                .toArray());

            // number as id
            // url as content_url
        }
    }

    shouldSkip(pull: Pull, exclude?: Map<number, number>) {
        let excludeTimestamp = exclude?.get(pull.number);
        if (!excludeTimestamp) return false; // not excluded
        if (Date.now() >= (excludeTimestamp + MAX_EXCLUDE_TIMEOUT)) return false; // past the skip window
        const skipUntil = new Date(excludeTimestamp).toISOString();
        const lastUpdate = pull.lastUpdatedAt || pull.updated_at;
        return lastUpdate < skipUntil; // updated since we skipped
    }

    /**
     * List all the comments in a pull request.
     * @param pull The pull request.
     * @param since The date (in ISO8601 format) from which to start listing comments
     */
    async listComments(pull: Pull, since?: string) {
        return await this._checkResponse(fromAsync(this._github.paginate.iterator(this._github.rest.issues.listComments,
            {
                ...this._ownerAndRepo,
                issue_number: pull.number,
                since
            }))
            .selectMany(response => response.data)
            .orderBy(comment => comment.created_at)
            .toArray());
    }

    /**
     * List all the commits in a pull request.
     * @param pull The pull request.
     * @param since The date (in ISO8601 format) from which to start listing commits
     */
    async listCommits(pull: Pull, since?: string) {
        let query: AsyncQuery<Commit>;
        if (pull.commits <= 250 || !pull.head.repo) {
            // max allowed to retrieve...
            query = fromAsync(this._github.paginate.iterator(this._github.rest.pulls.listCommits,
                {
                    ...this._ownerAndRepo,
                    pull_number: pull.number
                }))
                .selectMany(response => response.data);
            if (since) {
                query = query
                    .where(commit => !since || (commit.commit.committer?.date || "") >= since);
            }
        }
        else {
            query = fromAsync(this._github.paginate.iterator(this._github.rest.repos.listCommits,
                {
                    owner: pull.head.repo.owner.login,
                    repo: pull.head.repo.name,
                    sha: pull.head.sha,
                    since
                }))
                .selectMany(response => response.data);
        }
        return await this._checkResponse(query.orderBy(commit => commit.commit.committer?.date)
            .toArray());
    }

    /**
     * List all the APPROVED or CHANGES REQUESTED reviews in a pull request.
     * @param pull The pull request.
     * @param since The date (in ISO8601 format) from which to start listing commits
     */
    async listReviews(pull: Pull, options?: { since?: string, latest?: boolean, lastCommit?: Commit }) {
        const since = options?.since ?? "";
        const latest = options?.latest;
        const lastCommit = options?.lastCommit;
        let reviews: Review[] | null | undefined = await this._checkResponse(fromAsync(this._github.paginate.iterator(this._github.rest.pulls.listReviews,
            {
                ...this._ownerAndRepo,
                pull_number: pull.number,
            }))
            .selectMany(response => response.data)
            .where(review => !since || (review.submitted_at ?? "") >= since)
            .where(ProjectService.isReview)
            .toArray());
        if (reviews?.length && latest) {
            reviews = ProjectService.latestReviews(reviews);
        }
        if (reviews?.length && lastCommit) {
            for (const review of reviews) {
                review.isOutdated = (review.submitted_at || "") < (lastCommit.commit.committer?.date || "");
            }
        }
        return reviews?.length ? reviews : undefined;
    }

    /**
     * Gets the pull request associated with a card.
     * @param card The project board card.
     * @param includeDrafts Whether to include Draft PRs
     * @param includeWip Whether to include PRs marked WIP
     * @param exclude A map of PR numbers to exclude to the Date they were excluded (in milliseconds since the UNIX epoch)
     */
    async getPullFromCard(card: Card, includeDrafts?: boolean, includeWip?: boolean, exclude?: Map<number, number>): Promise<GetPullResult> {
        const match = /(\d+)$/.exec(card.content_url || "");
        if (!match) {
            return { error: true, message: "Could not determine pull number" };
        }

        return this.getPull(+match[1], includeDrafts, includeWip, exclude);
    }

    /**
     * Gets a pull request.
     * @param pull_number The PR number of the pull.
     * @param includeDrafts Whether to include Draft PRs
     * @param includeWip Whether to include PRs marked WIP
     * @param exclude A map of PR numbers to exclude to the Date they were excluded (in milliseconds since the UNIX epoch)
     */
    async getPull(pull_number: number, includeDrafts?: boolean, includeWip?: boolean, exclude?: Map<number, number>): Promise<GetPullResult> {
        const { data: pull }: { data: Pull } = await this._checkResponse(this._github.rest.pulls.get({ ...this._ownerAndRepo, pull_number }));
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
            .map(label => [label.name!, label]));

        if (labels.has("Revision needed")) {
            return { error: true, message: `'${pull.title.trim()}' is awaiting revisions` };
        }

        // fetch and organize the comments for the pull
        const skipTimestamp = exclude?.get(pull.number);
        const skipUntil = skipTimestamp ? new Date(skipTimestamp).toISOString() : undefined;
        for (const comment of await this.listComments(pull)) {
            if (comment.user?.login === "typescript-bot") {
                if (!pull.botWelcomeComment && /<!--typescript_bot_welcome-->/i.test(comment.body || "")) {
                    pull.botWelcomeComment = comment;
                }
            }
            else {
                pull.lastComment = comment;
                if (skipUntil && comment.created_at > skipUntil) {
                    pull.recentComments ??= [];
                    pull.recentComments.push(comment);
                }
            }
        }

        // list commits and define the update date for the PR excluding bot updates
        const commits = await this.listCommits(pull);
        pull.lastCommit = from(commits).last();

        const lastCommentDate = pull.lastComment?.created_at ?? "";
        const lastCommitDate = pull.lastCommit?.commit.committer?.date ?? "";
        pull.lastUpdatedAt =
            lastCommentDate > lastCommitDate ? lastCommentDate :
            lastCommitDate > lastCommentDate ? lastCommitDate :
            pull.updated_at;

        if (this.shouldSkip(pull, exclude)) {
            return { error: true, message: `'${pull.title.trim()}' was previously skipped` };
        }

        // find the DT bot status message
        const body = pull.botWelcomeComment?.body;
        if (body) {
            let match: RegExpExecArray | null;
            if (match = /## Status(?:\r?\n)+((?:\s\*.*?(?:\r?\n))*)/.exec(body)) {
                const botStatus = match[1]
                    .replace(/\[(.*?)\]\(.*?\)/, (_, s) => s)
                    .split(/\r?\n/g)
                    .map(s => ' ' + s.trim());
                pull.botStatus = botStatus?.length ? botStatus : undefined;
            }
            if (match = /\n```json\s*\n(.*)\n```\s*\n?/s.exec(body)) {
                try {
                    pull.botData = JSON.parse(match[1]);
                }
                catch {}
            }
            pull.supportsSelfMerge = !!pull.botStatus || !!pull.botData;
        }

        const [me, maintainers, reviews] = await Promise.all([
            this.getAuthenticatedUser(),
            this.listMaintainers(),
            this.listReviews(pull, { latest: true, lastCommit: pull.lastCommit })
        ]);

        ProjectService.updatePullStatus(pull, reviews, me, maintainers);
        return { error: false, pull, labels: [...labels.values()] };
    }

    async latestCommit(pull: Pull) {
        if (pull.commits > 0) {
            if (pull.head.repo) {
                const { data: [commit] } = await this._checkResponse(this._github.rest.repos.listCommits({
                    owner: pull.head.repo.owner.login,
                    repo: pull.head.repo.name,
                    sha: pull.head.sha,
                    per_page: 1
                }));
                return commit;
            }
            else {
                const { data: [commit] } = await this._checkResponse(this._github.rest.pulls.listCommits({
                    ...this._ownerAndRepo,
                    pull_number: pull.number,
                    page: pull.commits - 1,
                    per_page: 1
                }));
                return commit;
            }
        }
    }

    /**
     * Approves a pull.
     */
    async approvePull(pull: Pull): Promise<void> {
        // refresh the PR
        const result = await this.getPull(pull.number);
        if (result.error) return;
        pull = result.pull;

        // if we've already approved, there's nothing to do here.
        if (pull.approvedByMe === true) {
            return;
        }

        const { data: draftReview } = await this._checkResponse(this._github.rest.pulls.createReview({
            ...this._ownerAndRepo,
            pull_number: pull.number,
        }));
        if (!draftReview) return;

        await this._checkResponse(this._github.rest.pulls.submitReview({
            ...this._ownerAndRepo,
            pull_number: pull.number,
            event: "APPROVE",
            review_id: draftReview.id
        }));

        const [me, maintainers, reviews] = await Promise.all([
            this.getAuthenticatedUser(),
            this.listMaintainers(),
            this.listReviews(pull, { latest: true, lastCommit: pull.lastCommit })
        ]);

        ProjectService.updatePullStatus(pull, reviews, me, maintainers);
    }

    /**
     * Merges a pull.
     */
    async mergePull(pull: Pull, method?: "merge" | "squash" | "rebase"): Promise<void> {
        await this._checkResponse(this._github.rest.pulls.merge({
            ...this._ownerAndRepo,
            pull_number: pull.number,
            merge_method: method
        }));
    }
}