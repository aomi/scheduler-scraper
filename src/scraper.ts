import cheerio from 'cheerio';
import request from 'request-promise';
import { performance } from 'perf_hooks';
import fs from 'fs';
import * as readline from 'readline';
import { log } from 'util';

const BASE_URL = 'https://web.uvic.ca/calendar2020-01/CDs/';
const SECTIONS_URL = 'https://www.uvic.ca/BAN1P/bwckctlg.p_disp_listcrse';

interface Course {
  code: string;
  sections: Section[];
  subject: string;
  title: string;
  term: string;
}

interface Section {
  crn: string;
  sectionType: string;
  sectionNumber: string;
}

/**
 * Gets the department/subject codes
 *
 * @returns {string[]} an array of department codes
 */
const getDepartments = async () => {
  try {
    const response = await request(BASE_URL);
    const $ = cheerio.load(response);
    const departments: string[] = [];
    $('a').each((index, element) => {
      const department = $(element).attr('href');
      if (department && /^[A-Z]+/g.test(department)) {
        departments.push(department.slice(0, -1));
      }
    });
    return departments;
  } catch (error) {
    console.log(error);
    throw new Error('Failed to get department data');
  }
};

/**
 * Gets the course number codes
 *
 * @param {string} department a department code - e.g. 'CSC'
 *
 * @returns {string[]} an array of course codes
 */
const getCourseCodes = async (department: string) => {
  try {
    const response = await request(`${BASE_URL}${department}`);
    const $ = cheerio.load(response);

    const courses: string[] = [];
    $('a').each((index, element) => {
      const course = $(element).attr('href');
      if (course && /^[0-7]+/g.test(course)) {
        courses.push(course.slice(0, course.indexOf('.')));
      }
    });
    return courses;
  } catch (error) {
    throw new Error('Failed to get course data');
  }
};

/**
 * Gets the crns for the given course
 *
 * @param {string} params - query params used with the sections url
 *
 * @returns {number[]} - an array of crns
 */
const getSections = async (params: string) => {
  try {
    // response = await request(url, { family: 4 });
    const response = await request(`${SECTIONS_URL}${params}`);
    const $ = cheerio.load(response);
    const sections: Section[] = [];
    $('a').each((index, element) => {
      const linkText = $(element).text();
      if (linkText && /[\w\s]*-[\d\s]*-.*-.*/g.test(linkText)) {
        const linkArray = linkText.split('-');
        const crn = linkArray[1].trim();
        const sectionType = linkArray[3].charAt(1);
        const sectionNumber = linkArray[3].slice(2, 4);
        sections.push({ crn, sectionType, sectionNumber });
      }
    });
    return sections;
  } catch (error) {
    throw new Error('Failed to get sections');
  }
};

/**
 * Gets the courses that are currently being offered
 *
 * @param {string} subject a subject/department code - e.g. 'CSC'
 * @param {string} code a subject code - e.g. '421'
 *
 * @typedef {Object} Course
 * @property {numer} code - course code
 * @property {number[]} crns - section crns
 * @property {string} subject - the course department/subject
 * @property {string} title - the course title
 * @property {number} term - the term the course is offered
 *
 * @returns {Course} - an array of all courses currently offered
 */
const getOffered = async (subject: string, code: string) => {
  try {
    const response = await request(`${BASE_URL}${subject}/${code}.html`);
    const $ = cheerio.load(response);

    const title = $('h2').text();

    const schedules: string[] = [];
    $('#schedules')
      .find('a')
      .each((index, element) => {
        const temp = $(element).attr('href');
        if (temp) schedules.push(temp.slice(temp.indexOf('?'), temp.length));
      });

    const courses: Course[] = [];
    for (const schedule of schedules) {
      const sections = await getSections(schedule);
      const term = (schedule.match(/term_in=(\d+)/) || [])[1];
      if (sections.length) {
        courses.push({ code, sections, subject, title, term: term || '0' });
      }
    }
    return courses;
  } catch (error) {
    throw new Error('Failed to get avaliable sections');
  }
};

const main = async () => {
  // Hide cursor and start timer
  process.stdout.write('\u001B[?25l');
  const start = performance.now();

  const failed: string[] = [];
  const departments = await getDepartments();
  process.stdout.write('Getting courses for ');
  const results: Course[] = [];
  for (const department of departments) {
    try {
      readline.cursorTo(process.stdout, 20);
      process.stdout.write(`${department}  `);
      const courseCodes = await getCourseCodes(department);

      const courses = await Promise.all(courseCodes.map(async code => await getOffered(department, code)));
      results.push(...courses.flat());
    } catch (error) {
      failed.push(department);
    }
  }
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);

  // Stop timer and show cursor
  const finish = performance.now();
  process.stdout.write('\u001B[?25h');

  if (failed.length) {
    console.log(failed);
  }
  console.log(`Getting course data took ${(finish - start) / 60000} minutes`);

  fs.writeFileSync('courses.json', JSON.stringify(results, null, 2));
};

main();
