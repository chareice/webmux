import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../store';
import { getServerUrl } from '../api';
import { colors, commonStyles } from '../theme';

export default function SettingsScreen(): React.JSX.Element {
  const { logout } = useAuth();
  const serverUrl = getServerUrl();

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => void logout(),
      },
    ]);
  };

  return (
    <View style={commonStyles.screen}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Server</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>URL</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {serverUrl || 'Not configured'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.7}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
    marginHorizontal: 16,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    color: colors.text,
    fontSize: 15,
  },
  rowValue: {
    color: colors.textSecondary,
    fontSize: 14,
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  logoutButton: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: {
    color: colors.red,
    fontSize: 16,
    fontWeight: '600',
  },
});
