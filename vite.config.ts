import { defineConfig } from 'vite';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === 'true' && repositoryName;

export default defineConfig({
  base: isGitHubPagesBuild ? `/${repositoryName}/` : '/',
});
