/* eslint-disable no-restricted-syntax,  no-await-in-loop */
import { simpleGit } from 'simple-git';
import semver from 'semver';
import fs from 'fs';
import path from 'path';
import { readSvgDirectory } from './helpers.mjs';

const DATE_OF_FORK = '2020-06-08T16:39:52+0100';

const git = simpleGit();

const currentDir = process.cwd();
const ICONS_DIR = path.resolve(currentDir, '../icons');
const iconJsonFiles = readSvgDirectory(ICONS_DIR, '.json');

const location = path.resolve(currentDir, '.vitepress/data', 'releaseMetaData.json');

if (fs.existsSync(location)) {
  fs.unlinkSync(location);
}

const fetchAllReleases = async () => {
  await git.fetch('https://github.com/lucide-icons/lucide.git', '--tags');

  return Promise.all(
    (await git.tag(['-l']))
      .trim()
      .split(/\n/)
      .filter((tag) => semver.valid(tag))
      .sort(semver.compare),
  );
};

const tags = await fetchAllReleases();

const comparisonsPromises = tags.map(async (tag, index) => {
  const previousTag = tags[index - 1];

  if (!previousTag) return undefined;

  const diff = await git.diff(['--name-status', '--oneline', previousTag, tag]);
  const files = diff.split('\n').map((line) => {
    const [status, file, renamedFile] = line.split('\t');

    return { status, file, renamedFile };
  });

  const iconFiles = files.filter(({ file }) => file != null && file.startsWith('icons/'));
  let date = (await git.show(['-s', '--format=%cI', tag])).trim();

  // Fallback to dat of fork if date is not valid
  if (!date.startsWith('20')) {
    date = DATE_OF_FORK;
  }

  return {
    tag,
    date,
    iconFiles,
  };
});

const comparisons = await Promise.all(comparisonsPromises);
const newReleaseMetaData = {};

comparisons.forEach(({ tag, iconFiles, date } = {}) => {
  if (tag == null) return;

  iconFiles.forEach(({ status, file, renamedFile }) => {
    if (file.endsWith('.json')) return;

    const version = tag.replace('v', '');
    let iconName = path.basename(file, '.svg');

    if (status.startsWith('R')) {
      iconName = path.basename(renamedFile, '.svg');
    }

    if (newReleaseMetaData[iconName] == null) newReleaseMetaData[iconName] = {};

    const releaseData = {
      version,
      date,
    };

    if (status === 'A') {
      if ('changedRelease' in newReleaseMetaData[iconName]) {
        throw new Error(`Icon '${iconName}' has already changedRelease set.`);
      }

      newReleaseMetaData[iconName].createdRelease = releaseData;
      newReleaseMetaData[iconName].changedRelease = releaseData;
    }
    if (status === 'M') {
      newReleaseMetaData[iconName].changedRelease = {
        version,
        date,
      };
    }
  });
});

const defaultReleaseMetaData = {
  createdRelease: {
    version: '0.1.0',
    date: DATE_OF_FORK,
  },
  changedRelease: {
    version: '0.1.0',
    date: DATE_OF_FORK,
  },
};

const releaseMetaData = (
  await Promise.all(
    iconJsonFiles.map((iconJsonFile) => {
      const iconName = path.basename(iconJsonFile, '.json');

      if (iconName in newReleaseMetaData === false) {
        console.error(`Could not find release metadata for icon '${iconName}'.`);
      }

      return {
        name: iconName,
        ...defaultReleaseMetaData,
        ...(newReleaseMetaData[iconName] ?? {}),
      };
    }),
  )
).reduce((acc, { name, ...rest }) => {
  acc[name] = rest;
  return acc;
}, {});

fs.promises
  .writeFile(location, JSON.stringify(releaseMetaData, null, 2), 'utf-8')
  .then(() => {
    console.log('Successfully written icon release meta cache file');
  })
  .catch((error) => {
    throw new Error(`Something went wrong generating icon release meta cache file,\n ${error}`);
  });