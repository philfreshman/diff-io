import { Combobox as Base } from "@base-ui/react/combobox";
import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./Combobox.module.css";

export interface ComboboxProps<T> {
	/** Accessible name for the input. */
	label: string;
	/** Everything the list may show, before filtering. */
	items: readonly T[];
	/** The text in the input, owned by the caller. */
	inputValue: string;
	onInputValueChange(value: string): void;
	/** A row was chosen — by click, by Enter, or by touch. */
	onSelect(item: T): void;
	/** How an item reads as text: what a selection writes into the input. */
	itemToText(item: T): string;
	/** How a row is drawn. Defaults to the item's text. */
	renderItem?(item: T): ReactNode;
	/**
	 * Enter with nothing highlighted. Package search accepts whatever was typed;
	 * a version selector, whose list is the only truth, leaves this out.
	 */
	onSubmitText?(text: string): void;
	/**
	 * Substring match by default. Pass `null` when the items already answer the
	 * query — a search API has filtered them for us.
	 */
	filter?: null | ((item: T, query: string) => boolean);
	/** The caller owns the fetching; this only says the list is on its way. */
	loading?: boolean;
	loadingMessage?: string;
	emptyMessage?: string;
	placeholder?: string;
	disabled?: boolean;
	/** Rendered inside the input's box: the search/spinner/reset slot. */
	trailing?: ReactNode;
	/**
	 * The list opened or closed. A version selector types into the input to
	 * filter, so it needs the close in order to put the selected version back;
	 * package search keeps whatever was typed and ignores this.
	 */
	onOpenChange?(open: boolean): void;
}

function substringFilter(text: string, query: string): boolean {
	return text.toLowerCase().includes(query.toLowerCase());
}

/**
 * The one combobox: package search and both version selectors are the same
 * interaction — a text input over a filtered list, driven by ↑↓/Enter/Escape.
 * The old app had three hand-rolled copies and three sets of bugs.
 */
export function Combobox<T>({
	label,
	items,
	inputValue,
	onInputValueChange,
	onSelect,
	itemToText,
	renderItem,
	onSubmitText,
	filter,
	loading = false,
	loadingMessage = "Loading…",
	emptyMessage = "No matches",
	placeholder,
	disabled = false,
	trailing,
	onOpenChange,
}: ComboboxProps<T>) {
	// Enter is ambiguous: with a row highlighted it selects that row, with none
	// it accepts the raw text. Base UI owns the first case, so this only has to
	// know whether a highlight exists.
	const highlighted = useRef<T | undefined>(undefined);
	// Open is controlled so focus can open the list. Base UI ignores the click
	// that focuses an input — deliberate on its part, but the old app showed
	// search history the moment the field was focused, and that is the
	// affordance the design asks for.
	const [open, setOpen] = useState(false);
	// Nothing here works until React has hydrated: a click or a keystroke before
	// that hits a dead input. `data-ready` is the handshake — for tests, and for
	// anything that wants to style the field until then.
	const [ready, setReady] = useState(false);
	useEffect(() => setReady(true), []);

	return (
		<Base.Root
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				onOpenChange?.(next);
			}}
			items={items as T[]}
			inputValue={inputValue}
			onInputValueChange={(value, details) => {
				// Escape reverts the input to the selected value; the design says it
				// only closes the list and leaves what was typed alone.
				if (details.reason === "input-clear") return;
				onInputValueChange(value);
			}}
			onValueChange={(value) => {
				if (value !== null) onSelect(value as T);
			}}
			onItemHighlighted={(item) => {
				highlighted.current = item as T | undefined;
			}}
			itemToStringLabel={(item) => itemToText(item as T)}
			itemToStringValue={(item) => itemToText(item as T)}
			filter={
				filter === null
					? null
					: filter
						? (item, query) => filter(item as T, query)
						: (item, query) => substringFilter(itemToText(item as T), query)
			}
			openOnInputClick
			loopFocus
			disabled={disabled}
		>
			<div className={styles.field} data-ready={ready ? "" : undefined}>
				<Base.Input
					className={styles.input}
					aria-label={label}
					placeholder={placeholder}
					onFocus={() => setOpen(true)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || highlighted.current !== undefined) {
							return;
						}
						const text = inputValue.trim();
						if (text) onSubmitText?.(text);
					}}
				/>
				{trailing ? <span className={styles.trailing}>{trailing}</span> : null}
			</div>

			<Base.Portal>
				<Base.Positioner className={styles.positioner} sideOffset={4}>
					<Base.Popup className={styles.popup}>
						{loading ? (
							<p className={styles.status} role="status">
								{loadingMessage}
							</p>
						) : (
							<>
								<Base.Empty className={styles.status}>
									{emptyMessage}
								</Base.Empty>
								<Base.List className={styles.list}>
									{(item: T) => (
										<Base.Item
											className={styles.item}
											key={itemToText(item)}
											value={item}
										>
											{renderItem ? renderItem(item) : itemToText(item)}
										</Base.Item>
									)}
								</Base.List>
							</>
						)}
					</Base.Popup>
				</Base.Positioner>
			</Base.Portal>
		</Base.Root>
	);
}
