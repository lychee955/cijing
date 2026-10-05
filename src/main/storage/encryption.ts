export interface Encryption {
    isEncryptionAvailable(): boolean;
    encryptString(value: string): Buffer;
    decryptString(value: Buffer): string;
    getSelectedStorageBackend?(): string;
}

export function canEncrypt(encryption: Encryption, platform: NodeJS.Platform): boolean {
    return (
        encryption.isEncryptionAvailable() &&
        !(platform === "linux" && encryption.getSelectedStorageBackend?.() === "basic_text")
    );
}
