export declare function parse(body: string): Machines;
export declare class Netrc {
    file: string;
    machines: Machines;
    constructor(file?: string);
    load(): Promise<void>;
    loadSync(): void;
    save(): Promise<void>;
    saveSync(): void;
    private get output();
    private get defaultFile();
    private get gpgDecryptArgs();
    private get gpgEncryptArgs();
}
declare const _default: Netrc;
export default _default;
export type Token = MachineToken | {
    type: 'other';
    content: string;
};
export type MachineToken = {
    type: 'machine';
    pre?: string;
    host: string;
    internalWhitespace: string;
    props: {
        [key: string]: {
            value: string;
            comment?: string;
        };
    };
    comment?: string;
};
export type Machines = {
    [key: string]: {
        login?: string;
        password?: string;
        account?: string;
        [key: string]: string | undefined;
    };
};
