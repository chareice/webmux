import { View, Text, ScrollView, StyleSheet } from "react-native";
import { TerminalCard } from "./TerminalCard.android";
import { colors } from "@/lib/colors";
export function Canvas({ terminals, maximizedId, isMobile, isMachineController, deviceId, onMaximize, onMinimize, onDestroy, }) {
    return (<View style={styles.container}>
      {terminals.length === 0 ? (<View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>{"\u2B21"}</Text>
          <Text style={styles.emptyText}>
            Tap {"\u2630"} to open a terminal
          </Text>
        </View>) : (<ScrollView contentContainerStyle={styles.grid}>
          {terminals.map((terminal) => (<TerminalCard key={terminal.id} terminal={terminal} maximized={maximizedId === terminal.id} isMobile={isMobile} isController={isMachineController(terminal.machine_id)} deviceId={deviceId} onMaximize={() => onMaximize(terminal.id)} onMinimize={onMinimize} onDestroy={() => onDestroy(terminal)}/>))}
        </ScrollView>)}
    </View>);
}
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
        padding: 12,
        paddingTop: 52,
    },
    emptyContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: 16,
        opacity: 0.3,
        color: colors.foregroundMuted,
    },
    emptyText: {
        color: colors.foregroundMuted,
        fontSize: 14,
    },
    grid: {
        gap: 12,
        paddingBottom: 20,
    },
});
