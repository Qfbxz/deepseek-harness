/**
 * Browser side of dsh-market: settings.section card that fetches
 * /dsh-market/{registry,installed,status,updates} and triggers
 * /dsh-market/{install,uninstall,update,setup-pnpm} on the host.
 *
 * The browser bundle registers a single settings.section entry whose
 * component is the panel; the cordis client ctx supplies only `slots`,
 * the runtime supplies `React` (and primitives as needed).
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        'settings.section': {
            kind: 'list';
            scope: 'root';
            owner: { close: () => void };
        };
    }
}
export {};
