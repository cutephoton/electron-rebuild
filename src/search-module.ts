import * as fs from 'fs-extra';
import * as path from 'path';

async function shouldContinueSearch(traversedPath: string, rootPath?: string, stopAtPackageJSON?: boolean): Promise<boolean> {
  if (rootPath) {
    return Promise.resolve(traversedPath !== path.dirname(rootPath));
  } else if (stopAtPackageJSON) {
    return fs.pathExists(path.join(traversedPath, 'package.json'));
  } else {
    return true;
  }
}

type PathGeneratorFunction = (traversedPath: string) => string;

async function traverseAncestorDirectories(
  cwd: string,
  pathGenerator: PathGeneratorFunction,
  rootPath?: string,
  maxItems?: number,
  stopAtPackageJSON?: boolean
): Promise<string[]> {
  const paths: string[] = [];
  let traversedPath = path.resolve(cwd);

  while (await shouldContinueSearch(traversedPath, rootPath, stopAtPackageJSON)) {
    const generatedPath = pathGenerator(traversedPath);
    if (await fs.pathExists(generatedPath)) {
      paths.push(generatedPath);
    }

    const parentPath = path.dirname(traversedPath);
    if (parentPath === traversedPath || (maxItems && paths.length >= maxItems)) {
      break;
    }
    traversedPath = parentPath;
  }

  return paths;
}

/**
 * Find all instances of a given module in node_modules subdirectories while traversing up
 * ancestor directories.
 *
 * @param cwd the initial directory to traverse
 * @param moduleName the Node module name (should work for scoped modules as well)
 * @param rootPath the project's root path. If provided, the traversal will stop at this path.
 */
export async function searchForModule(
  cwd: string,
  moduleName: string,
  rootPath?: string
): Promise<string[]> {
  const pathGenerator: PathGeneratorFunction = (traversedPath) => path.join(traversedPath, 'node_modules', moduleName);
  return traverseAncestorDirectories(cwd, pathGenerator, rootPath, undefined, true);
}

/**
 * Find all instances of node_modules subdirectories while traversing up ancestor directories.
 *
 * @param cwd the initial directory to traverse
 * @param rootPath the project's root path. If provided, the traversal will stop at this path.
 */
export async function searchForNodeModules(cwd: string, rootPath?: string): Promise<string[]> {
  const pathGenerator: PathGeneratorFunction = (traversedPath) => path.join(traversedPath, 'node_modules');
  return traverseAncestorDirectories(cwd, pathGenerator, rootPath, undefined, true);
}

function* splitPath(cwd:string) {
  for(let part = path.parse(path.resolve(cwd)); part.base !== ""; part = path.parse(part.dir)) {
    yield path.join(part.dir, part.base);
  }
}

type NodeModuleEntry = {
  path: string;
  manifest: string;
  hasLockfile: boolean;
};

async function* getNodeModulePaths(cwd:string) : AsyncGenerator<NodeModuleEntry> {
  for (const part of splitPath(cwd)) {
    const manifest = path.join(part, "package.json");
    if (await fs.pathExists(manifest)) {
      yield {
        path:part,
        manifest: manifest,
        hasLockfile: await fs.pathExists(path.join(part, "package-lock.json")) || await fs.pathExists(path.join(part, "yarn.lock"))
      };
    }
  }
}

/**
 * Determine the root directory of a given project, by looking for a directory with an
 * NPM or yarn lockfile.
 *
 * @param cwd the initial directory to traverse
 */
export async function getProjectRootPath(cwd: string): Promise<string> {
  let candidate = path.resolve(cwd);

  for await (const root of getNodeModulePaths(cwd)) {
    if (root.hasLockfile) {
      candidate = root.path;
      const manifest = JSON.parse(await fs.readFile(root.manifest, {encoding: "utf-8"}));
      if ("workspaces" in manifest) {
        break;
      }
    }
  }

  return candidate;
}
