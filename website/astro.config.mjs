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
						{ label: "Installation", slug: "guides/installation" },
						{ label: "Usage", slug: "guides/usage" },
					],
				},
				{
					label: "Core Concepts",
					items: [
						{
							label: "Worktree Management",
							slug: "guides/worktree-management",
						},
						{ label: "Configuration", slug: "guides/configuration" },
					],
				},
				{
					label: "Reference",
					items: [
						{ label: "Step Types", slug: "reference/step-types" },
						{ label: "Branch Filtering", slug: "reference/branch-filtering" },
						{ label: "Features", slug: "reference/features" },
					],
				},
			],
			customCss: [
				// './src/styles/custom.css',
			],
		}),
	],
});
