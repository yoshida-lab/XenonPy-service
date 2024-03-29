// Copyright 2021 TsumiNa
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React, { useEffect } from 'react'
import Head from 'next/head'
import { AppProps } from 'next/app'
import { Provider as AuthProvider } from 'next-auth/client'
import { ThemeProvider as StyledThemeProvider } from 'styled-components'
import { ThemeProvider as MaterialThemeProvider, StylesProvider } from '@material-ui/core/styles'
import CssBaseline from '@material-ui/core/CssBaseline'

import theme from '../styles/theme'

// wrapped App
const App = ({ Component, pageProps }: AppProps) => {
  useEffect(() => {
    // Remove the server-side injected CSS.
    const jssStyles = document.querySelector('#jss-server-side')
    if (jssStyles && jssStyles.parentElement) {
      jssStyles.parentElement.removeChild(jssStyles)
    }
  }, [])

  return (
    <>
      <Head>
        <title>XenonPy MDL</title>
        <meta name="viewport" content="minimum-scale=1, initial-scale=1, width=device-width" />
      </Head>
      {/* Enable styled overwritten */}
      <StylesProvider injectFirst>
        {/* Material UI */}
        <MaterialThemeProvider theme={theme}>
          {/* Styled-component */}
          <StyledThemeProvider theme={theme}>
            {/* CssBaseline kickstart an elegant, consistent, and simple baseline to build upon. */}
            <CssBaseline />
            {/* NextAuth */}
            <AuthProvider options={{ clientMaxAge: 0, keepAlive: 0 }} session={pageProps.session}>
              <Component {...pageProps} />
            </AuthProvider>
          </StyledThemeProvider>
        </MaterialThemeProvider>
      </StylesProvider>
    </>
  )
}

export default App
