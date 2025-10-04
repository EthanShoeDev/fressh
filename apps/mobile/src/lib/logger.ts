import { logger, consoleTransport } from "react-native-logs";

export const rootLogger = logger.createLogger({
    levels: {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    },
    severity: "debug",
    transport: consoleTransport,
    transportOptions: {
        colors: {
            info: "blueBright",
            warn: "yellowBright",
            error: "redBright",
        },
    },
    async: true,
    dateFormat: "time",
    printLevel: true,
    printDate: true,
    fixedExtLvlLength: false,
    enabled: true,
});
