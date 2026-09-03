"use client"

import { useEffect, useRef, useState } from "react"
import { groupConversations } from "../hooks/useConversations"
import type { Conversation } from "../lib/types"
import {
	BrandIcon,
	ChartIcon,
	CodeIcon,
	DownloadIcon,
	FolderIcon,
	LockIcon,
	NewChatIcon,
	SearchIcon,
	SettingsIcon,
	SidebarIcon,
	SignOutIcon,
	TrashIcon,
	UserIcon,
} from "./icons"

export function Sidebar({
	conversations,
	activeId,
	collapsed,
	accountLabel,
	planName,
	corniaCode,
	onUpgrade,
	onNewChat,
	onSelect,
	onRename,
	onDelete,
	onToggle,
	onOpenSettings,
	onOpenFiles,
	onExportAll,
	onSignOut,
}: {
	conversations: Conversation[]
	activeId?: string
	collapsed: boolean
	accountLabel: string
	planName: string
	/** Cornia Code is Max-only; without it the row becomes an upgrade prompt. */
	corniaCode: boolean
	onUpgrade: () => void
	onNewChat: () => void
	onSelect: (id: string) => void
	onRename: (id: string, title: string) => void
	onDelete: (id: string) => void
	onToggle: () => void
	onOpenSettings: () => void
	onOpenFiles: () => void
	onExportAll: () => void
	onSignOut: () => void
}) {
	const [query, setQuery] = useState("")
	const [renamingId, setRenamingId] = useState<string | undefined>(undefined)
	const [renameValue, setRenameValue] = useState("")
	const renameRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (renamingId) {
			renameRef.current?.focus()
			renameRef.current?.select()
		}
	}, [renamingId])

	const normalized = query.trim().toLowerCase()
	const filtered =
		normalized.length === 0
			? conversations
			: conversations.filter((conversation) =>
					conversation.title.toLowerCase().includes(normalized),
				)

	const commitRename = () => {
		if (renamingId) {
			onRename(renamingId, renameValue.trim() || "New chat")
		}
		setRenamingId(undefined)
	}

	return (
		<nav
			aria-label="Chat history"
			className={`sidebar ${collapsed ? "collapsed" : ""}`}
		>
			<div className="sidebarHeader">
				<span className="brandMark">
					<BrandIcon />
				</span>
				<button
					aria-label="Close sidebar"
					className="iconButton"
					onClick={onToggle}
					title="Close sidebar"
					type="button"
				>
					<SidebarIcon />
				</button>
			</div>

			<div className="sidebarActions">
				<button className="sidebarItem" onClick={onNewChat} type="button">
					<NewChatIcon className="icon sm" />
					New chat
				</button>
				<button className="sidebarItem" onClick={onOpenFiles} type="button">
					<FolderIcon className="icon sm" />
					Workspace files
				</button>
			</div>

			<div className="searchField">
				<SearchIcon className="icon sm" />
				<label className="srOnly" htmlFor="history-search">
					Search chats
				</label>
				<input
					id="history-search"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search chats"
					type="search"
					value={query}
				/>
			</div>

			<div className="historyScroll">
				{groupConversations(filtered).map((group) => (
					<div className="historyGroup" key={group.label}>
						<div className="historyGroupLabel">{group.label}</div>
						{group.items.map((conversation) => (
							<div
								className={`historyRow ${conversation.id === activeId ? "active" : ""}`}
								key={conversation.id}
							>
								{renamingId === conversation.id ? (
									<input
										className="historyRename"
										onBlur={commitRename}
										onChange={(event) => setRenameValue(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												commitRename()
											}
											if (event.key === "Escape") {
												setRenamingId(undefined)
											}
										}}
										ref={renameRef}
										value={renameValue}
									/>
								) : (
									<>
										<button
											className="historyOpen"
											onClick={() => onSelect(conversation.id)}
											onDoubleClick={() => {
												setRenameValue(conversation.title)
												setRenamingId(conversation.id)
											}}
											type="button"
										>
											{conversation.title}
										</button>
										<button
											aria-label={`Delete ${conversation.title}`}
											className="iconButton rowMenu"
											onClick={() => onDelete(conversation.id)}
											title="Delete chat"
											type="button"
										>
											<TrashIcon className="icon sm" />
										</button>
									</>
								)}
							</div>
						))}
					</div>
				))}

				{filtered.length === 0 ? (
					<p className="filesEmpty">
						{conversations.length === 0
							? "Your chats will appear here."
							: "No chats match that search."}
					</p>
				) : null}
			</div>

			<div className="sidebarFooter">
				{corniaCode ? (
					<a className="sidebarItem" href="/code">
						<CodeIcon className="icon sm" />
						Cornia Code
					</a>
				) : (
					<button
						className="sidebarItem locked"
						onClick={onUpgrade}
						type="button"
					>
						<CodeIcon className="icon sm" />
						Cornia Code
						<span className="badge locked sidebarBadge">
							<LockIcon className="icon xs" />
							Max
						</span>
					</button>
				)}
				<a className="sidebarItem" href="/account">
					<ChartIcon className="icon sm" />
					Account &amp; usage
				</a>
				<button className="sidebarItem" onClick={onExportAll} type="button">
					<DownloadIcon className="icon sm" />
					Export all chats
				</button>
				<button className="sidebarItem" onClick={onOpenSettings} type="button">
					<SettingsIcon className="icon sm" />
					Settings &amp; role
				</button>
				<div className="accountRow">
					<a
						className="accountRowMain"
						href="/account"
						title="See your plan and usage"
					>
						<span className="avatar">
							<UserIcon className="icon xs" />
						</span>
						<span className="accountText">
							<strong>{accountLabel}</strong>
							<span>{planName} · usage</span>
						</span>
					</a>
					<button
						aria-label="Sign out of ChatGPT"
						className="iconButton"
						onClick={onSignOut}
						title="Sign out of ChatGPT"
						type="button"
					>
						<SignOutIcon className="icon sm" />
					</button>
				</div>
			</div>
		</nav>
	)
}
