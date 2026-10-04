/** Absolute path of this package's root directory. */
export declare const PACKAGE_ROOT: string;
/** Provider name registered with the DSH skill registry. */
export declare const PROVIDER_NAME: 'reverse-skill-upstream';
/** Rank of the bundled tier. */
export declare const SKILL_RANK: number;
/** Directories scanned recursively for SKILL.md files. */
export declare const SKILL_ROOTS: readonly string[];
/** Cordis plugin name. */
export declare const name: 'reverse-skill-upstream';
/** Services this plugin depends on. */
export declare const inject: readonly string[];
/** Register the bundled reverse-skill corpus as a DSH skill provider. */
export declare function apply(ctx: unknown): void;
