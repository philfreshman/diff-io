import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { useHighlightTheme } from "#/components/diff/useHighlightTheme.ts";
import {
	CheckIcon,
	ChevronRightIcon,
	SettingsIcon,
} from "#/components/ui/icons.tsx";
import { HIGHLIGHT_THEMES } from "#/lib/diff/highlightThemes.ts";
import styles from "./SettingsMenu.module.css";

/**
 * The gear: everything about how a diff is read that is not a button in its
 * own right on the toolbar.
 *
 * It is a navigation menu rather than a select because it holds settings of
 * more than one kind — a switch, and a list long enough to want a fold of its
 * own — and because that is what the two of them will keep being as more are
 * added.
 */
export function SettingsMenu() {
	const highlight = useHighlightTheme();

	return (
		<NavigationMenu.Root className={styles.root} orientation="vertical">
			<NavigationMenu.List className={styles.list}>
				<NavigationMenu.Item>
					<NavigationMenu.Trigger
						className={styles.gear}
						aria-label="Settings"
						title="Settings"
					>
						<SettingsIcon width="16" height="16" />
					</NavigationMenu.Trigger>

					<NavigationMenu.Content className={styles.content}>
						<ul className={styles.options}>
							<li>
								{/* Stated rather than hidden: the setting is coming, and
								    saying so is what stops it being asked for again. Once it
								    is live it says so the way a chosen theme does — with a
								    tick at the end of its own row. */}
								<button className={styles.option} disabled type="button">
									Ignore whitespaces
								</button>
							</li>

							<li>
								{/* Twenty-three themes are a list to scan, not a row of
								    controls, so they fold in behind their own name. */}
								<NavigationMenu.Root orientation="vertical">
									<NavigationMenu.List className={styles.options}>
										<NavigationMenu.Item>
											<NavigationMenu.Trigger
												className={styles.option}
												data-testid="theme-fold"
											>
												Theme
												<span className={styles.value}>
													{label(highlight.theme)}
												</span>
												<NavigationMenu.Icon className={styles.fold}>
													<ChevronRightIcon width="14" height="14" />
												</NavigationMenu.Icon>
											</NavigationMenu.Trigger>

											<NavigationMenu.Content className={styles.content}>
												<ul className={styles.options}>
													{HIGHLIGHT_THEMES.map((theme) => (
														<li key={theme.value}>
															<button
																className={styles.option}
																data-testid="theme-option"
																data-theme={theme.value}
																aria-pressed={highlight.theme === theme.value}
																onClick={() => highlight.choose(theme.value)}
																type="button"
															>
																{theme.label}
																{highlight.theme === theme.value && (
																	<CheckIcon
																		className={styles.chosen}
																		width="14"
																		height="14"
																	/>
																)}
															</button>
														</li>
													))}
												</ul>
											</NavigationMenu.Content>
										</NavigationMenu.Item>
									</NavigationMenu.List>

									<NavigationMenu.Portal>
										<NavigationMenu.Positioner
											className={styles.positioner}
											sideOffset={8}
											alignOffset={-8}
											align="start"
											side="left"
										>
											<NavigationMenu.Popup
												className={styles.popup}
												data-testid="theme-popup"
											>
												<NavigationMenu.Viewport className={styles.viewport} />
											</NavigationMenu.Popup>
										</NavigationMenu.Positioner>
									</NavigationMenu.Portal>
								</NavigationMenu.Root>
							</li>
						</ul>
					</NavigationMenu.Content>
				</NavigationMenu.Item>
			</NavigationMenu.List>

			<NavigationMenu.Portal>
				<NavigationMenu.Positioner
					className={styles.positioner}
					sideOffset={6}
					align="end"
				>
					<NavigationMenu.Popup className={styles.popup}>
						<NavigationMenu.Viewport className={styles.viewport} />
					</NavigationMenu.Popup>
				</NavigationMenu.Positioner>
			</NavigationMenu.Portal>
		</NavigationMenu.Root>
	);
}

/** The name of the theme in force, or nothing until it has been read. */
function label(theme: string | null): string {
	return HIGHLIGHT_THEMES.find((it) => it.value === theme)?.label ?? "";
}
