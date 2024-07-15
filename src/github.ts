/*!
   Copyright 2019 Microsoft Corporation

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

import type { IssuesListCommentsResponseItem, Options, ProjectsListForRepoResponseItem, PullsGetResponseLabelItem, PullsListCommitsResponseItem, PullsListReviewsResponseItem, ReposListCommitsResponseItem, TeamsListMembersResponse, TeamsListMembersResponseItem, UsersGetAuthenticatedResponse } from "@octokit/core";
import type { RequestParameters } from "@octokit/graphql/types";
import { FragmentOf, graphql, readFragment, ResultOf, type TadaDocumentNode } from "gql.tada";
import { print } from "graphql";
import { AsyncQuery, fn, from, fromAsync } from "iterable-query";
import { Octokit } from "octokit";

const MAX_EXCLUDE_TIMEOUT = 1000 * 60 * 60 * 24 * 7; // check back at least once every 7 days...

/** A GitHub Project Board */
export interface Project extends ProjectsListForRepoResponseItem { }

/** A Column in a GitHub Project Board */
export interface Column { name: string; }

/** A Card in a GitHub Project Board */
export interface Card extends ProjectItem { }

export interface Comment extends IssuesListCommentsResponseItem { }

/** A GitHub Pull Request, with some additional options */
export interface Pull extends ResultOf<typeof PullRequestFragment> {
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
    /** Names of the Project Board columns to use for PR rundown. */
    columns?: readonly K[];
}

// TODO: Make this configurable or something because we keep changing it...
export class ProjectService<K extends string> {
    static readonly defaultProject = "Pull Request Status Board";
    static readonly defaultColumns = ["Needs Maintainer Review", "Needs Maintainer Action"] as const;

    private _github: Octokit;
    private _ownerAndRepo: { owner: string, repo: string };
    private _team: string | undefined;
    private _columnNames: readonly K[];
    private _columns: Record<K, Column> | null | undefined;
    private _project: ResultOf<typeof ProjectV2Fragment> | null | undefined;
    private _projectName: string;
    private _projectViewColumnGroupByFieldName: string | null | undefined;
    private _projectViewName: string = "PRs";
    private _user: UsersGetAuthenticatedResponse | null | undefined;
    private _teamMembers: TeamsListMembersResponseItem[] | null | undefined;
    private _graphql: GitHubGQL;

    constructor(options: ProjectServiceOptions<K>) {
        this._github = new Octokit(options.github);
        const {
            owner,
            repo,
            project = ProjectService.defaultProject,
            columns = ProjectService.defaultColumns,
            team,
        } = options;
        this._projectName = project;
        this._columnNames = columns as readonly K[];
        this._ownerAndRepo = { owner, repo };
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

    /**
     * Gets the current authenticated user.
     */
    async getAuthenticatedUser(): Promise<UsersGetAuthenticatedResponse | undefined> {
        if (this._user === undefined) {
            try {
                const { data: user } = await this._github.rest.users.getAuthenticated();
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
                const members = await fromAsync(this._github.paginate.iterator(this._github.rest.teams.listMembersInOrg,
                    {
                        org: this._ownerAndRepo.owner,
                        team_slug: this._team
                    }))
                    .selectMany(response => response.data)
                    .whereDefined()
                    .toArray();
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
                const iterator = this._graphql.paginate.iterator(ProjectsV2Query, { ...this._ownerAndRepo });
                this._project = await fromAsync(iterator)
                    .selectMany(response => response.repository?.projectsV2.nodes ?? [])
                    .select(project => readFragment<typeof ProjectV2Fragment>(project))
                    .where(project => project.title === this._projectName)
                    .single();
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

    async getProjectViewColumnGroupByFieldName() {
        if (this._projectViewColumnGroupByFieldName === undefined) {
            const { number: project_number } = await this.getProject();
            try {
                const iterator = this._graphql.paginate.iterator(ProjectV2ViewsQuery, { ...this._ownerAndRepo, project_number });
                this._projectViewColumnGroupByFieldName = await fromAsync(iterator)
                    .selectMany(response => response.repository?.projectV2?.views.nodes ?? [])
                    .select(view => readFragment<typeof ProjectV2ViewFragment>(view))
                    .skipUntil(view => view.name === this._projectViewName).take(1)
                    .selectMany(view => view.verticalGroupByFields?.nodes ?? [])
                    .where(field => field.__typename === "ProjectV2SingleSelectField")
                    .select(field => field.name)
                    .first();
            }
            catch (e) {
                this._projectViewColumnGroupByFieldName = null;
                throw e;
            }
        }
        if (!this._projectViewColumnGroupByFieldName) {
            throw new Error(`Could not find view '${this._projectViewName}' for project '${this._projectName}'.`);
        }
        return this._projectViewColumnGroupByFieldName;
    }

    async getProjectItems(): Promise<ProjectItem[]> {
        const { number: project_number } = await this.getProject();
        const column_field = await this.getProjectViewColumnGroupByFieldName();
        const iterator = this._graphql.paginate.iterator(ProjectItemsQuery, { ...this._ownerAndRepo, project_number, column_field });
        return await fromAsync(iterator)
            .selectMany(response => response.repository?.projectV2?.items.nodes ?? [])
            .where(node => node.fieldValueByName?.__typename === "ProjectV2ItemFieldSingleSelectValue")
            .where(node => node.content?.__typename === "PullRequest")
            .select(node => ({
                ...node,
                content: readFragment<typeof PullRequestFragment>(node.content as FragmentOf<typeof PullRequestFragment>)
            }) as ProjectItem)
            .where(node => this._columnNames.includes(node.fieldValueByName.name as K))
            .where(node => node.content.state === "OPEN")
            .distinctBy(node => node.content.number)
            .toArray();
    }

    /**
     * Gets the project board columns.
     */
    async getColumns() {
        if (this._columns === undefined) {
            this._columns = {} as Record<K, Column>;
            for (const columnName of this._columnNames) {
                this._columns[columnName] = { name: columnName as string } as Column;
            }
        }
        if (!this._columns) {
            throw new Error(`Could not resolve columns`);
        }
        return this._columns;
    }

    shouldSkip(pull: Pull, exclude?: Map<number, number>) {
        let excludeTimestamp = exclude?.get(pull.number);
        if (!excludeTimestamp) return false; // not excluded
        if (Date.now() >= (excludeTimestamp + MAX_EXCLUDE_TIMEOUT)) return false; // past the skip window
        const skipUntil = new Date(excludeTimestamp).toISOString();
        const lastUpdate = pull.lastUpdatedAt || pull.updatedAt;
        return lastUpdate < skipUntil; // updated since we skipped
    }

    /**
     * List all the comments in a pull request.
     * @param pull The pull request.
     * @param since The date (in ISO8601 format) from which to start listing comments
     */
    async listComments(pull: Pull, since?: string) {
        return await fromAsync(this._github.paginate.iterator(this._github.rest.issues.listComments,
            {
                ...this._ownerAndRepo,
                issue_number: pull.number,
                since
            }))
            .selectMany(response => response.data)
            .orderBy(comment => comment.created_at)
            .toArray();
    }

    /**
     * List all the commits in a pull request.
     * @param pull The pull request.
     * @param since The date (in ISO8601 format) from which to start listing commits
     */
    async listCommits(pull: Pull, since?: string) {
        let query: AsyncQuery<Commit>;
        if (pull.commits.totalCount <= 250 || !pull.headRepository?.name) {
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
                    owner: pull.headRepository.owner.login,
                    repo: pull.headRepository.name,
                    sha: pull.headRefOid,
                    since
                }))
                .selectMany(response => response.data);
        }
        return await query.orderBy(commit => commit.commit.committer?.date)
            .toArray();
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
        let reviews: Review[] | null | undefined = await fromAsync(this._github.paginate.iterator(this._github.rest.pulls.listReviews,
            {
                ...this._ownerAndRepo,
                pull_number: pull.number,
            }))
            .selectMany(response => response.data)
            .where(review => !since || (review.submitted_at ?? "") >= since)
            .where(ProjectService.isReview)
            .toArray();
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
        return this.finishGetPull(card.content, card.content.number, includeDrafts, includeWip, exclude);
    }

    /**
     * Gets a pull request.
     * @param pull_number The PR number of the pull.
     * @param includeDrafts Whether to include Draft PRs
     * @param includeWip Whether to include PRs marked WIP
     * @param exclude A map of PR numbers to exclude to the Date they were excluded (in milliseconds since the UNIX epoch)
     */
    async getPull(pull_number: number, includeDrafts?: boolean, includeWip?: boolean, exclude?: Map<number, number>): Promise<GetPullResult> {
        const response = await this._graphql(PullRequestQuery, { ...this._ownerAndRepo, pull_number });
        const pull = readFragment(PullRequestFragment, response.repository?.pullRequest) as Pull | undefined;
        return await this.finishGetPull(pull, pull_number, includeDrafts, includeWip, exclude);
    }

    private async finishGetPull(pull: Pull | undefined, pull_number: number, includeDrafts?: boolean, includeWip?: boolean, exclude?: Map<number, number>): Promise<GetPullResult> {
        if (!pull) {
            return { error: true, message: `PR ${pull_number} not found` };
        }

        if (pull.state === "CLOSED") {
            return { error: true, message: `'${pull.title.trim()}' is closed` };
        }

        if (pull.isDraft && !includeDrafts) {
            return { error: true, message: `'${pull.title.trim()}' is a draft and is not yet ready for review` };
        }

        if (/\bwip\b/i.test(pull.title) && !includeWip) {
            return { error: true, message: `'${pull.title.trim()}' is a work-in-progress and is not yet ready for review` };
        }

        const labels = new Map(pull.labels?.nodes
            ?.filter((label): label is Label => !!label && !!label.name)
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
                    pull.updatedAt;

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
                catch { }
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
        if (pull.commits.totalCount > 0) {
            if (pull.headRepository) {
                const { data: [commit] } = await this._github.rest.repos.listCommits({
                    owner: pull.headRepository.owner.login,
                    repo: pull.headRepository.name,
                    sha: pull.headRefOid,
                    per_page: 1
                });
                return commit;
            }
            else {
                const { data: [commit] } = await this._github.rest.pulls.listCommits({
                    ...this._ownerAndRepo,
                    pull_number: pull.number,
                    page: pull.commits.totalCount - 1,
                    per_page: 1
                });
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

        const { data: draftReview } = await this._github.rest.pulls.createReview({
            ...this._ownerAndRepo,
            pull_number: pull.number,
        });
        if (!draftReview) return;

        await this._github.rest.pulls.submitReview({
            ...this._ownerAndRepo,
            pull_number: pull.number,
            event: "APPROVE",
            review_id: draftReview.id
        });

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
        await this._github.rest.pulls.merge({
            ...this._ownerAndRepo,
            pull_number: pull.number,
            merge_method: method
        });
    }
}

declare module 'gql.tada' {
    interface setupSchema {
        scalars: {
            DateTime: string;
            GitObjectID: string;
            URI: string;
        }
    }
}

type GitHubGQLFunc = <R, V extends Record<string, unknown>>(
    query: TadaDocumentNode<R, V>,
    variables?: RequestParameters & V,
) => Promise<R>;

type GitHubGQLPaginateIteratorFunc = <R, V extends Record<string, unknown>>(
    query: TadaDocumentNode<R, V>,
    variables?: RequestParameters & V,
) => AsyncIterable<R>;

type GitHubGQL = GitHubGQLFunc & {
    paginate: GitHubGQLPaginate;
};

type GitHubGQLPaginate = GitHubGQLFunc & {
    iterator: GitHubGQLPaginateIteratorFunc;
};

type GQLResult<T> = T extends TadaDocumentNode<infer R, any, any> ? R : never;

function createGitHubGQL(octokit: Octokit): GitHubGQL {
    const gql: GitHubGQLFunc = (query, variables) =>
        octokit["graphql"]<GQLResult<typeof query>>(print(query), variables);

    const paginate: GitHubGQLFunc = (query, variables) =>
        octokit.graphql.paginate<GQLResult<typeof query> & object>(print(query), variables);

    const iterator: GitHubGQLPaginateIteratorFunc = (query, variables) =>
        octokit.graphql.paginate.iterator<GQLResult<typeof query>>(
            print(query),
            variables
        ) as AsyncIterable<GQLResult<typeof query>>;

    const gitHubGQL = gql as GitHubGQL;
    gitHubGQL.paginate = paginate as GitHubGQLPaginate;
    gitHubGQL.paginate.iterator = iterator;

    return gitHubGQL;
}

const ProjectV2Fragment = graphql(`
    fragment ProjectV2Fragment on ProjectV2 {
        __typename
        number
        title
    }
`);

const ProjectsV2Query = graphql(`
    query ProjectsQuery($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
            projectsV2(first: 1, after: $cursor) {
                nodes { ...ProjectV2Fragment }
                pageInfo { hasNextPage endCursor }
            }
        }
    }
`, [ProjectV2Fragment]);

const ProjectV2ViewFragment = graphql(`
    fragment ProjectV2ViewFragment on ProjectV2View {
        __typename
        number
        name
        verticalGroupByFields(first: 1) {
            nodes {
                __typename
                ... on ProjectV2SingleSelectField {
                    name
                }
            }
        }
    }
`);

const ProjectV2ViewsQuery = graphql(`
    query ProjectV2ViewsQuery($owner: String!, $repo: String!, $project_number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
            projectV2(number: $project_number) {
                views(first: 1, after: $cursor) {
                    pageInfo { hasNextPage, endCursor }
                    nodes { ...ProjectV2ViewFragment }
                }
            }
        }
    }
`, [ProjectV2ViewFragment]);

const PullRequestFragment = graphql(`
    fragment PullRequestFragment on PullRequest {
        __typename
        number
        url
        updatedAt
        state
        title
        author { login }
        labels(first: 20) {
            nodes {
                name
                color
            }
        }
        headRefOid
        headRepository {
            owner {
                login
            }
            name
        }
        isDraft
        mergeable
        commits {
            totalCount
        }
    }
`);

const ProjectItemsQuery = graphql(`
    query ProjectItems($owner: String!, $repo: String!, $project_number: Int!, $column_field: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
            projectV2(number: $project_number) {
                items(first: 20, after: $cursor) {
                    pageInfo { hasNextPage endCursor }
                    nodes {
                        __typename
                        fieldValueByName(name: $column_field) {
                            ... on ProjectV2ItemFieldSingleSelectValue {
                                __typename
                                name
                            }
                        }
                        content { ... PullRequestFragment }
                    }
                }
            }
        }
    }
`, [PullRequestFragment]);

const PullRequestQuery = graphql(`
    query PullRequest($owner: String!, $repo: String!, $pull_number: Int!) {
        repository(owner: $owner, name: $repo) {
            pullRequest(number: $pull_number) { ...PullRequestFragment }
        }
    }
`, [PullRequestFragment]);

type __ProjectItemBuilder<T = NonNullable<NonNullable<NonNullable<NonNullable<ResultOf<typeof ProjectItemsQuery>>["repository"]>["projectV2"]>["items"]["nodes"]>[number]> = {
    [P in keyof T]:
        P extends "fieldValueByName" ? Extract<T[P], { __typename: "ProjectV2ItemFieldSingleSelectValue" }> :
        P extends "content" ? ResultOf<typeof PullRequestFragment> :
        T[P]
};

export type ProjectItem = __ProjectItemBuilder;
