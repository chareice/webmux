import { View, Text, Pressable } from "react-native";
import { Link, usePathname } from "expo-router";
import { useAuth } from "../lib/auth";

const NAV_ITEMS = [
  { label: "Agents", href: "/" as const },
  { label: "Threads", href: "/threads" as const },
  { label: "Projects", href: "/projects" as const },
  { label: "Settings", href: "/settings" as const },
];

export function TopBar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname === "";
    }
    return pathname.startsWith(href);
  };

  return (
    <View className="h-12 bg-surface flex-row items-center px-4 border-b border-border">
      {/* Logo */}
      <Text className="text-foreground text-lg font-bold mr-8">webmux</Text>

      {/* Nav links */}
      <View className="flex-row flex-1 items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} asChild>
              <Pressable className="px-3 py-1.5 rounded">
                <Text
                  className={
                    active
                      ? "text-accent font-semibold text-sm"
                      : "text-foreground-secondary text-sm"
                  }
                >
                  {item.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>

      {/* User info + logout */}
      <View className="flex-row items-center gap-3">
        {user && (
          <Text className="text-foreground-secondary text-sm">
            {user.displayName}
          </Text>
        )}
        <Pressable onPress={logout} className="px-3 py-1.5 rounded">
          <Text className="text-foreground-secondary text-sm">Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}
