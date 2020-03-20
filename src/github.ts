import { from } from "iterable-query";
import Github = require("@octokit/rest");

export interface ProjectServiceOptions<K extends string> {
    github: Github.Options;
    owner: string;
    repo: string;
    project?: string;
    columns?: readonly K[];
}

export interface Project extends Github.ProjectsListForRepoResponseItem {}
export interface Column extends Github.ProjectsListColumnsResponseItem {}
export interface Card extends Github.ProjectsListCardsResponseItem {}
export interface Pull extends Github.PullsGetResponse {
    approved?: boolean;
}

export interface GetPullSuccessResult {
    error: false;
    pull: Pull;
    labels: ReadonlySet<string>;
}

export interface GetPullFailureResult {
    error: true;
    message: string;
}

export type GetPullResult = GetPullSuccessResult | GetPullFailureResult;

export class ProjectService<K extends string = "Check and Merge" | "Review"> {
    static readonly defaultProject = "Pull Request Status Board";
    static readonly defaultColumns = ["Check and Merge", "Review"] as const;

    private _github: Github;
    private _project: string;
    private _columns: readonly K[];
    private _ownerAndRepo: { owner: string, repo: string };
    private _userId: number | undefined;

    constructor(options: ProjectServiceOptions<K>) {
        this._github = new Github(options.github);
        const {
            owner,
            repo,
            project = ProjectService.defaultProject,
            columns = ProjectService.defaultColumns,
        } = options;
        this._project = project;
        this._columns = columns as readonly K[];
        this._ownerAndRepo = { owner, repo };
    }

    async getProject() {
        const projects = (await this._github.projects.listForRepo({ ...this._ownerAndRepo, state: "open" })).data;
        const project = projects.find(proj => proj.name === this._project);
        if (!project) throw new Error(`Could not find project '${this._project}'.`);
        return project;
    }

    async getColumns(project: Project) {
        const columnList = (await this._github.projects.listColumns({ project_id: project.id })).data;
        const columns: Record<K, Column> = Object.create(null);
        const requestedColumns = new Set<string>(this._columns);
        for (const col of columnList) {
            if (requestedColumns.has(col.name)) {
                requestedColumns.delete(col.name);
                columns[col.name as K] = col;
            }
        }

        for (const key of requestedColumns.keys()) {
            throw new Error(`Could not find '${key}' column.`);
        }

        return columns;
    }

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

    async getPull(card: Card, includeDrafts?: boolean): Promise<GetPullResult> {
        const match = /(\d+)$/.exec(card.content_url);
        if (!match) {
            return { error: true, message: "Could not determine pull number" };
        }

        const pull = (await this._github.pulls.get({ ...this._ownerAndRepo, pull_number: +match[1] })).data;
        if (pull.state === "closed") {
            return { error: true, message: `'${pull.title}' is closed` };
        }

        if ((pull.draft || pull.mergeable_state === "draft") && !includeDrafts) {
            return { error: true, message: `'${pull.title}' is a draft and is not yet ready for review` };
        }

        const labels = new Set(pull.labels.map(label => label.name));
        if (labels.has("Revision needed")) {
            return { error: true, message: `'${pull.title}' is awaiting revisions` };
        }

        const id = await this.whoAmiI();
        const reviews = await this._github.pulls.listReviews({
            ...this._ownerAndRepo,
            pull_number: pull.number
        });
        const review = reviews.data?.find(review => review.user.id === id);
        const approved = review?.state === "APPROVED";
        return { error: false, pull: { ...pull, approved }, labels };
    }

    async whoAmiI(): Promise<number | undefined> {
        if (this._userId === undefined) {
            const auth = await this._github.users.getAuthenticated();
            if (!auth.data) {
                return;
            }
            this._userId = auth.data.id;
        }
        return this._userId;
    }

    async approvePull(pull: Pull): Promise<void> {
        const auth = await this._github.users.getAuthenticated();
        if (!auth.data) {
            return;
        }

        const id = auth.data.id;
        const reviews = await this._github.pulls.listReviews({ ...this._ownerAndRepo, pull_number: pull.number });
        if (reviews.data) {
            for (const review of reviews.data) {
                if (review.user.id === id && review.state === "APPROVED") return;
            }
        }

        const review = await this._github.pulls.createReview({
            ...this._ownerAndRepo,
            pull_number: pull.number,
        });
        if (!review.data) return;

        await this._github.pulls.submitReview({
            ...this._ownerAndRepo,
            pull_number: pull.number,
            event: "APPROVE",
            review_id: review.data.id
        });

        pull.approved = true;
    }

    async mergePull(pull: Pull, method?: "merge" | "squash" | "rebase"): Promise<void> {
        await this._github.pulls.merge({
            ...this._ownerAndRepo,
            pull_number: pull.number,
            merge_method: method
        });
    }
}