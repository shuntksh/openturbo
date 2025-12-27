// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	site: "https://shuntksh.github.io",
	base: "/openturbo",
	integrations: [
		starlight({
			title: "OpenTurbo",
			social: [
				{
					label: "GitHub",
					icon: "github",
					href: "https://github.com/shuntksh/openturbo",
				},
			],
			sidebar: [
				{
					label: "Start Here",
					items: [
						{ label: "Installation", slug: "openturbo/guides/installation" },
						{ label: "Usage", slug: "openturbo/guides/usage" },
					],
				},
				{
					label: "Core Concepts",
					items: [
						{
							label: "Worktree Management",
							slug: "openturbo/guides/worktree-management",
						},
						{ label: "Configuration", slug: "openturbo/guides/configuration" },
					],
				},
				{
					label: "Reference",
					items: [
						{ label: "Step Types", slug: "openturbo/reference/step-types" },
						{ label: "Branch Filtering", slug: "openturbo/reference/branch-filtering" },
						{ label: "Features", slug: "openturbo/reference/features" },
					],
				},
			],
			customCss: [
				// './src/styles/custom.css',
			],
		}),
	],
});
