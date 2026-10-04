import {ClientError} from "../maimemo/errors";

export class ExitGate {
    private locked = false;
    private active = 0;
    get closing(): boolean {
        return this.locked;
    }
    async run<T>(action: () => T | Promise<T>): Promise<T> {
        if (this.locked) throw new ClientError("BUSY");
        this.active++;
        try {
            return await action();
        } finally {
            this.active--;
        }
    }
    acquire(busy: () => boolean): boolean {
        if (this.locked || this.active > 0 || busy()) return false;
        this.locked = true;
        return true;
    }
    release(): void {
        this.locked = false;
    }
}
