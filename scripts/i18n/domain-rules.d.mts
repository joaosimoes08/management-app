export declare const MESSAGES_DIRECTORY: string;
export declare function isSkippedDirectory(relativePath: string): boolean;
export declare function duplicateKeys(keyList: Iterable<string>): string[];
export declare function isKeyUsed(key: string, appText: string): boolean;
export declare function collidingKeys(domainKeys: Iterable<string>, localeTableKeys: ReadonlySet<string>): string[];
