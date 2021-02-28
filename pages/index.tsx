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

import { gql, useQuery } from 'urql'
import { Typography } from '@material-ui/core'

import { Layout } from '../components/Layout'
import { withUrqlClient } from 'next-urql'
import { API_ENTRYPOINT, initSSUrql } from '../lib/urql-client'

import styled from 'styled-components'

const StyledTypography = styled(Typography)`
  background: linear-gradient(45deg, #fe6b8b 30%, #ff8e53 90%);
  background: radial-gradient(45deg);
  border: 0;
  borderradius: 3;
  boxshadow: 0 3px 5px 2px rgba(255, 105, 135, 0.3);
  color: white;
  height: 48;
  padding: 0 30px;
`

const API_VERSION = gql`
  query GetAPIVersion {
    apiVersion
  }
`

export async function getStaticProps() {
  const { client, ssrCache } = initSSUrql()

  await client.query(API_VERSION).toPromise()

  return {
    props: {
      // urqlState is a keyword here so withUrqlClient can pick it up.
      urqlState: ssrCache.extractData()
    },
    revalidate: 600
  }
}

function Page() {
  const [res] = useQuery({ query: API_VERSION })

  // SSR or SSG need fetch data on the fly
  // give a default value to escape the error
  const apiVersion = res.data?.apiVersion ?? 'unknown'
  return (
    <Layout apiVersion={apiVersion}>
      <StyledTypography variant="body1">Place holder</StyledTypography>
    </Layout>
  )
}

export default withUrqlClient(
  _ssr => ({
    url: API_ENTRYPOINT
  }),
  { ssr: false }
)(Page)
