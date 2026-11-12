import { createRepositories, type Repositories } from "./repositories";
import { openDatabase } from "./database";

let repositoriesPromise: Promise<Repositories> | null = null;

export function getRepositories(): Promise<Repositories> {
  if (!repositoriesPromise) {
    repositoriesPromise = openDatabase()
      .then((database) => createRepositories(database))
      .catch((error: unknown) => {
        repositoriesPromise = null;
        throw error;
      });
  }

  return repositoriesPromise;
}

