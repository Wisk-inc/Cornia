module.exports=[9273,a=>{"use strict";var b=a.i(58481);let c=`(() => {
	try {
		const stored = localStorage.getItem("agent.theme")
		const theme = stored === "light" || stored === "dark"
			? stored
			: (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
		document.documentElement.dataset.theme = theme
	} catch {}
})()`;a.s(["default",0,function({children:a}){return(0,b.jsxs)("html",{lang:"en",suppressHydrationWarning:!0,children:[(0,b.jsx)("head",{children:(0,b.jsx)("script",{dangerouslySetInnerHTML:{__html:c}})}),(0,b.jsx)("body",{children:a})]})},"metadata",0,{title:"Agent — build with your ChatGPT account",description:"A ChatGPT-style coding agent with a sandbox terminal, file tools and web search, powered by your own ChatGPT account.",icons:{icon:[{sizes:"32x32",type:"image/png",url:"/favicon-32x32.png"}],apple:"/apple-touch-icon.png",shortcut:"/favicon-32x32.png"}},"viewport",0,{themeColor:[{media:"(prefers-color-scheme: light)",color:"#ffffff"},{media:"(prefers-color-scheme: dark)",color:"#212121"}],initialScale:1,maximumScale:1,viewportFit:"cover",width:"device-width"}])},71899,a=>{a.n(a.i(9273))}];

//# sourceMappingURL=artifacts_openai-agent_app_layout_tsx_0-xinrn._.js.map