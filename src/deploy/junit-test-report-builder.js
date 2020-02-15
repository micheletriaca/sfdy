const builder = require('junit-report-builder')
const _ = require('highland')

const buildJunitTestReport = (runTestResult, reportPath = 'test-reports/test-report.xml') => {
  const suite = builder.testSuite().name('Sfdc tests')
  return _([
    ...[runTestResult.successes],
    ...[runTestResult.failures]
  ])
    .flatten()
    .filter(x => x)
    .map(x => {
      const testCase = suite.testCase()
        .className(x.name)
        .name(x.methodName)
        .time(parseInt(x.time) / 1000)
      if (x.stackTrace) {
        testCase
          .error(x.message, x.type)
          .stacktrace(x.stackTrace)
      }
    })
    .collect()
    .toPromise(Promise)
    .then(() => builder.writeTo(reportPath))
}

module.exports = buildJunitTestReport
