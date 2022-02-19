const builder = require('junit-report-builder')
const _ = require('exstream.js')

const buildJunitTestReport = (runTestResult, reportPath = 'test-reports/test-report.xml') => {
  const suite = builder.testSuite().name('Sfdc tests')
  _([
    ...[runTestResult.successes],
    ...[runTestResult.failures]
  ])
    .flatten()
    .filter(x => x)
    .each(x => {
      const testCase = suite
        .testCase()
        .className(x.name)
        .name(x.methodName)
        .time(parseInt(x.time) / 1000)
      if (x.stackTrace) {
        testCase
          .failure(x.message, x.type)
          .stacktrace(x.stackTrace)
      }
    })

  builder.writeTo(reportPath)
}

module.exports = buildJunitTestReport
